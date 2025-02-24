package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"
)

type Appointment struct {
	BeginDateTime time.Time `json:"begin_datetime"`
	EndDateTime   time.Time `json:"end_datetime"`
	Title         string    `json:"title"`
	Message       string    `json:"message"`
	ChannelURL    string    `json:"channel_url"`
	Reminders     []int     `json:"reminders"`
}

type ReminderInfo struct {
	ID        string    `json:"id"`
	TimePoint time.Time `json:"time_point"`
}

type ErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

var (
	db           *sql.DB
	timers       = map[string]*time.Timer{}
	appointments []Appointment
	webhookUrl   string
	loc          *time.Location
)

func If[T any](cond bool, vtrue, vfalse T) T {
	if cond {
		return vtrue
	}
	return vfalse
}

func timeUntil(t time.Time) string {
	timeUntil := time.Until(t)
	if timeUntil < 0 {
		timeUntil = 0
	}
	timeUntil = timeUntil.Round(time.Second)
	if timeUntil < time.Minute {
		return fmt.Sprintf("%d %s", int(timeUntil.Seconds()), If(timeUntil.Seconds() == 1, "Sekunde", "Sekunden"))
	}
	timeUntil = timeUntil.Round(time.Minute)
	if timeUntil < time.Hour {
		return fmt.Sprintf("%d %s", int(timeUntil.Minutes()), If(timeUntil.Minutes() == 1, "Minute", "Minuten"))
	}
	timeUntil = timeUntil.Round(time.Hour)
	if timeUntil < 12*time.Hour {
		return fmt.Sprintf("%d %s", int(timeUntil.Hours()), If(timeUntil.Hours() == 1, "Stunde", "Stunden"))
	}
	days := int(timeUntil.Hours()) / 24
	return fmt.Sprintf("%d %s", days, If(days == 1, "Tag", "Tage"))
}

func sendAppointmentCancellation(appointment Appointment) {
	data := map[string]any{
		"type": "Message",
		"attachments": []map[string]any{
			{
				"contentType": "application/vnd.microsoft.card.adaptive",
				"content": map[string]any{
					"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
					"version": "1.5",
					"type":    "AdaptiveCard",
					"body": []any{
						map[string]any{
							"type":   "TextBlock",
							"size":   "large",
							"weight": "bolder",
							"color":  "attention",
							"text":   "ABGESAGT!",
							"style":  "heading",
							"wrap":   true,
						},
						map[string]any{
							"type": "TextBlock",
							"text": "Folgendes Ereignis wurde abgesagt:",
							"wrap": true,
						},
						map[string]any{
							"type":   "TextBlock",
							"text":   appointment.Title,
							"style":  "heading",
							"weight": "bolder",
							"wrap":   true,
						},
						map[string]any{
							"type": "FactSet",
							"facts": []any{
								map[string]any{
									"title": "Datum",
									"value": appointment.BeginDateTime.In(loc).Format("02.01.2006"),
								},
								map[string]any{
									"title": "Beginn",
									"value": appointment.BeginDateTime.In(loc).Format("15:04"),
								},
								map[string]any{
									"title": "Ende",
									"value": appointment.EndDateTime.In(loc).Format("15:04"),
								},
								map[string]any{
									"title": "Ort",
									"value": "Teams",
								},
							},
						},
					},
				},
			},
		},
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("Error marshalling JSON data: %v", err)
		return
	}

	client := &http.Client{}
	req, err := http.NewRequest(http.MethodPost, webhookUrl, bytes.NewReader(jsonData))
	if err != nil {
		log.Printf("Error creating HTTP request: %v", err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error sending HTTP request: %v", err)
		return
	}

	defer resp.Body.Close()

	// der Body der Antwort ist typischerweise leer und wird im Folgenden
	// nur zu Demonstrationszwecken gelesen
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading response body: %v", err)
		return
	}
	log.Printf("Cancellation sent. Response: `%s`", body)
}

func sendAppointmentReminder(appointment Appointment) error {
	message := strings.ReplaceAll(appointment.Message, "%t", timeUntil(appointment.BeginDateTime))
	data := map[string]any{
		"type": "Message",
		"attachments": []map[string]any{
			{
				"contentType": "application/vnd.microsoft.card.adaptive",
				"content": map[string]any{
					"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
					"version": "1.5",
					"type":    "AdaptiveCard",
					"body": []any{
						map[string]any{
							"type":   "TextBlock",
							"size":   "large",
							"weight": "bolder",
							"text":   appointment.Title,
							"style":  "heading",
							"wrap":   true,
						},
						map[string]any{
							"type": "TextBlock",
							"text": message,
							"wrap": true,
						},
						map[string]any{
							"type": "FactSet",
							"facts": []any{
								map[string]any{
									"title": "Datum",
									"value": appointment.BeginDateTime.In(loc).Format("02.01.2006"),
								},
								map[string]any{
									"title": "Beginn",
									"value": appointment.BeginDateTime.In(loc).Format("15:04"),
								},
								map[string]any{
									"title": "Ende",
									"value": appointment.EndDateTime.In(loc).Format("15:04"),
								},
								map[string]any{
									"title": "Ort",
									"value": "Teams",
								},
							},
						},
					},
					"actions": []any{
						map[string]any{
							"type":  "Action.OpenUrl",
							"title": appointment.Title,
							"url":   appointment.ChannelURL,
						},
					},
				},
			},
		},
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		log.Printf("Error marshalling JSON data: %v", err)
		return err
	}

	client := &http.Client{}
	req, err := http.NewRequest(http.MethodPost, webhookUrl, bytes.NewReader(jsonData))
	if err != nil {
		log.Printf("Error creating HTTP request: %v", err)
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error sending HTTP request: %v", err)
		return err
	}

	defer resp.Body.Close()

	// der Body der Antwort ist typischerweise leer und wird im Folgenden
	// nur zu Demonstrationszwecken gelesen
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading response body: %v", err)
		return err
	}
	if len(body) == 0 {
		log.Printf("Appointment reminder sent. Response: `%s`", body)
		return nil
	}
	var potentialErrorMessage ErrorResponse
	err = json.Unmarshal(body, &potentialErrorMessage)
	if err != nil {
		log.Printf("Error unmarshaling JSON response: %v; data received: `%v`", err, body)
		return err
	}
	log.Printf("Appointment reminder NOT sent. %s: `%s`",
		potentialErrorMessage.Error.Code, potentialErrorMessage.Error.Message)
	if len(potentialErrorMessage.Error.Code) > 0 {
		return fmt.Errorf("%s: %s", potentialErrorMessage.Error.Code, potentialErrorMessage.Error.Message)
	}
	return nil
}

func generateUniqueID(t time.Time, reminder Appointment) string {
	return uuid.NewSHA1(uuid.Nil,
		[]byte(fmt.Sprintf("%s-%s-%s",
			t.Format(time.RFC3339), reminder.BeginDateTime.Format(time.RFC3339), reminder.Title))).String()
}

func isValidURL(str string) bool {
	url, err := url.Parse(str)
	if err != nil {
		return false
	}
	if url.Scheme != "http" &&
		url.Scheme != "https" {
		return false
	}
	if url.Host == "" {
		return false
	}
	return true
}

func appointmentExists(appointment Appointment) (bool, error) {
	var rowCount int
	appointmentRows, err := db.Query(`
        SELECT COUNT(*) FROM appointments WHERE begin_datetime = ? AND title = ?;
    `, appointment.BeginDateTime, appointment.Title)
	if err != nil {
		return false, err
	}
	defer appointmentRows.Close()
	appointmentRows.Scan(&rowCount)
	return rowCount > 0, nil
}

func deleteAppointment(appointment Appointment) error {
	_, err := db.Exec("DELETE FROM appointments WHERE begin_datetime = ? AND title = ?",
		appointment.BeginDateTime, appointment.Title)
	return err
}

func saveAppointment(appointment Appointment) error {
	if exists, err := appointmentExists(appointment); exists {
		return err
	}
	timeSpans, err := json.Marshal(appointment.Reminders)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
        INSERT INTO appointments (begin_datetime, end_datetime, title, message, channel_url, reminders)
        VALUES (?, ?, ?, ?, ?, ?)`,
		appointment.BeginDateTime, appointment.EndDateTime, appointment.Title,
		appointment.Message, appointment.ChannelURL, string(timeSpans))
	return err
}

func removeDuplicateReminders(appointment *Appointment) {
	slices.Sort(appointment.Reminders)
	appointment.Reminders = slices.Compact(appointment.Reminders)
}

func scheduleReminders(appointment Appointment) ([]ReminderInfo, error) {
	scheduledReminders := []ReminderInfo{}
	var err error
	for _, secs := range appointment.Reminders {
		notificationTime := appointment.BeginDateTime.Add(time.Duration(-secs) * time.Second)
		reminderID := generateUniqueID(notificationTime, appointment)
		if _, timerPresent := timers[reminderID]; timerPresent {
			continue
		}
		if secs < 0 {
			err = sendAppointmentReminder(appointment)
			if err != nil {
				return nil, err
			} else {
				continue
			}
		}
		timeUntilNotification := time.Until(notificationTime)
		if timeUntilNotification < 0 {
			continue
		}
		timer := time.AfterFunc(timeUntilNotification, func() {
			delete(timers, reminderID)
			sendAppointmentReminder(appointment)
			log.Printf("%s: %s", timeUntilNotification, appointment.Title)
		})

		log.Printf("Reminding %d secs before appointment (%v), current time: %v, time until notification: %v, ID: %s",
			secs, notificationTime, time.Now(), timeUntilNotification, reminderID)
		timers[reminderID] = timer
		scheduledReminders = append(scheduledReminders, ReminderInfo{reminderID, notificationTime})
	}
	return scheduledReminders, nil
}

func sendJSONResponse(w http.ResponseWriter, response map[string]any) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Encoding JSON reply failed", http.StatusBadRequest)
		return errors.New("encoding JSON reply failed")
	}
	return nil
}

func handleAppointmentSchedule(w http.ResponseWriter, r *http.Request) error {
	var appointment Appointment
	var errMsg []string
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&appointment); err != nil {
		errMsg = append(errMsg, fmt.Sprintf("Decoding JSON data failed with %s", err.Error()))
	}
	removeDuplicateReminders(&appointment)
	println("%v", appointment.BeginDateTime.Format(time.RFC3339))
	if appointment.BeginDateTime.Before(time.Now()) {
		errMsg = append(errMsg, "BeginDateTime must not be in the past")
	}
	if len(appointment.Title) == 0 {
		errMsg = append(errMsg, "field Title is required")
	}
	if len(appointment.Reminders) == 0 {
		errMsg = append(errMsg, "field Reminders is missing or empty")
	}
	if len(appointment.ChannelURL) > 0 && !isValidURL(appointment.ChannelURL) {
		errMsg = append(errMsg, "channel URL is not a valid URL")
	}
	var scheduledReminders []ReminderInfo
	var err error
	if len(errMsg) == 0 {
		scheduledReminders, err = scheduleReminders(appointment)
		if err != nil {
			log.Printf("Scheduling reminders() failed: %v", err)
			errMsg = append(errMsg, err.Error())
		}
		if err := saveAppointment(appointment); err != nil {
			log.Printf("Saving appointment failed: %v", err)
			errMsg = append(errMsg, err.Error())
		}
	}
	response := map[string]any{
		"success":   len(errMsg) == 0,
		"error":     errMsg,
		"reminders": scheduledReminders,
	}
	err = sendJSONResponse(w, response)
	return err
}

func cancelTimer(id string) error {
	log.Printf("Cancelling timer %s", id)
	if timer, ok := timers[id]; ok {
		if timer.Stop() {
			delete(timers, id)
			log.Printf("Timer for reminder %s canceled successfully", id)
			return nil
		} else {
			log.Printf("Timer for reminder %s already expired or stopped", id)
			return fmt.Errorf("timer for reminder %s already expired or stopped", id)
		}
	}
	log.Printf("No timer found for reminder with ID: %s", id)
	return fmt.Errorf("no timer found for reminder with ID: %s", id)
}

func cancelReminders(appointment Appointment) ([]ReminderInfo, error) {
	canceledReminders := []ReminderInfo{}
	for _, secs := range appointment.Reminders {
		notificationTime := appointment.BeginDateTime.Add(time.Duration(-secs) * time.Second)
		reminderID := generateUniqueID(notificationTime, appointment)
		if err := cancelTimer(reminderID); err != nil {
			continue
		}
		canceledReminders = append(canceledReminders, ReminderInfo{reminderID, notificationTime})
	}
	return canceledReminders, nil
}

func handleAppointmentCancel(w http.ResponseWriter, r *http.Request) error {
	var appointment Appointment
	if err := json.NewDecoder(r.Body).Decode(&appointment); err != nil {
		log.Printf("Decoding JSON data failed with %s", err.Error())
		http.Error(w, err.Error(), http.StatusBadRequest)
		return err
	}
	canceledReminders, err := cancelReminders(appointment)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   err.Error(),
		})
		return err
	}
	err = deleteAppointment(appointment)
	if err != nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   err.Error(),
		})
		return err
	}
	sendAppointmentCancellation(appointment)
	response := map[string]any{
		"success":   true,
		"reminders": canceledReminders,
	}
	err = sendJSONResponse(w, response)
	return err
}

func handleOptions(w http.ResponseWriter, _ *http.Request) error {
	w.Header().Set("Access-Control-Allow-Headers", "access-control-allow-origin,content-type")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	return nil
}

func handleAppointment(w http.ResponseWriter, r *http.Request) {
	var err error
	switch r.Method {
	case http.MethodPost:
		err = handleAppointmentSchedule(w, r)
	case http.MethodDelete:
		err = handleAppointmentCancel(w, r)
	case http.MethodOptions:
		err = handleOptions(w, r)
	default:
		http.Error(w, fmt.Sprintf("Bad method: %s", r.Method), http.StatusMethodNotAllowed)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
	}
}

func createTables(db *sql.DB) error {
	_, err := db.Exec(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY,
            begin_datetime DATETIME NOT NULL,
            end_datetime DATETIME NOT NULL,
            title TEXT NOT NULL,
            message TEXT,
            channel_url TEXT,
            reminders TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_appointments_title_datetime
        ON appointments(begin_datetime, title);
    `)
	return err
}

func loadAppointments(db *sql.DB) ([]Appointment, error) {
	appointment_rows, err := db.Query(`
        SELECT id, begin_datetime, end_datetime, title, message, channel_url, reminders FROM appointments;
    `)
	if err != nil {
		return nil, err
	}
	defer appointment_rows.Close()

	var appointments []Appointment
	for appointment_rows.Next() {
		var id int64
		var a Appointment
		var reminders string
		if err := appointment_rows.Scan(&id, &a.BeginDateTime, &a.EndDateTime, &a.Title, &a.Message, &a.ChannelURL, &reminders); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(reminders), &a.Reminders); err != nil {
			return nil, err
		}
		// TODO: remove reminders that are in the past, also update appointment in database
		appointments = append(appointments, a)
	}
	return appointments, nil
}

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("Error loading .env file: %v", err)
	}
	webhookUrl = os.Getenv("WEBHOOK_URL")
	log.Printf("Reminder Service starting up.")
	log.Printf("Will send requests to webhook URL '%s'", webhookUrl)

	log.Printf("Registered DB drivers: %v", sql.Drivers())

	loc, err = time.LoadLocation(os.Getenv("LOCATION"))
	if err != nil {
		log.Fatalf("Error loading location: %v", err)
	}

	db, err = sql.Open("sqlite3", os.Getenv("DB_FILE"))
	if err != nil {
		log.Fatalf("Error opening database: %v", err)
	}
	defer db.Close()

	err = createTables(db)
	if err != nil {
		log.Fatalf("Error creating tables: %v", err)
	}

	appointments, err = loadAppointments(db)
	if err != nil {
		log.Fatalf("Error loading appointments: %v", err)
	}
	for _, appointment := range appointments {
		log.Printf("Scheduling %v", appointment)
		scheduleReminders(appointment)
	}

	mux := http.NewServeMux()
	log.Printf("Serving http://%s:%s%s ...\n", os.Getenv("HOST"), os.Getenv("PORT"), os.Getenv("API_ENDPOINT"))
	mux.HandleFunc(os.Getenv("API_ENDPOINT"), handleAppointment)

	srv := &http.Server{
		Addr:    os.Getenv("HOST") + ":" + os.Getenv("PORT"),
		Handler: mux,
	}

	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("ListenAndServe() failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Server shutting down ...")
	for id, timer := range timers {
		if timer.Stop() {
			log.Printf("Timer for reminder %s canceled successfully", id)
		} else {
			log.Printf("Timer for reminder %s already expired or stopped", id)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server Shutdown Failed: %+v", err)
	}
	log.Println("Server exited gracefully.")
}
