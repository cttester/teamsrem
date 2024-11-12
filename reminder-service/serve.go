package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"slices"
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

type TimerData struct {
	Timer       *time.Timer
	ID          string
	Appointment Appointment
}

type ReminderInfo struct {
	ID        string    `json:"id"`
	TimePoint time.Time `json:"time_point"`
}

type Endpoint struct {
	path    string
	handler func(w http.ResponseWriter, r *http.Request)
}

var (
	db           *sql.DB
	timers       = map[string]*TimerData{}
	appointments []Appointment
	webhook_url  string
	loc          *time.Location
)

func sendAppointmentCancellation(appointment Appointment) {
	data := map[string]interface{}{
		"type": "Message",
		"attachments": []map[string]interface{}{
			{
				"contentType": "application/vnd.microsoft.card.adaptive",
				"content": map[string]interface{}{
					"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
					"version": "1.5",
					"type":    "AdaptiveCard",
					"body": []interface{}{
						map[string]interface{}{
							"type":   "TextBlock",
							"size":   "large",
							"weight": "bolder",
							"color":  "attention",
							"text":   "ABGESAGT!",
							"style":  "heading",
							"wrap":   true,
						},
						map[string]interface{}{
							"type": "TextBlock",
							"text": "Folgendes Ereignis wurde abgesagt:",
							"wrap": true,
						},
						map[string]interface{}{
							"type":   "TextBlock",
							"text":   appointment.Title,
							"style":  "heading",
							"weight": "bolder",
							"wrap":   true,
						},
						map[string]interface{}{
							"type": "FactSet",
							"facts": []interface{}{
								map[string]interface{}{
									"title": "Datum",
									"value": appointment.BeginDateTime.In(loc).Format("02.01.2006"),
								},
								map[string]interface{}{
									"title": "Beginn",
									"value": appointment.BeginDateTime.In(loc).Format("15:04"),
								},
								map[string]interface{}{
									"title": "Ende",
									"value": appointment.EndDateTime.In(loc).Format("15:04"),
								},
								map[string]interface{}{
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
	req, err := http.NewRequest(http.MethodPost, webhook_url, bytes.NewReader(jsonData))
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

func If[T any](cond bool, vtrue, vfalse T) T {
	if cond {
		return vtrue
	}
	return vfalse
}

func sendAppointmentReminder(appointment Appointment) error {
	data := map[string]interface{}{
		"type": "Message",
		"attachments": []map[string]interface{}{
			{
				"contentType": "application/vnd.microsoft.card.adaptive",
				"content": map[string]interface{}{
					"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
					"version": "1.5",
					"type":    "AdaptiveCard",
					"body": []interface{}{
						map[string]interface{}{
							"type":   "TextBlock",
							"size":   "large",
							"weight": "bolder",
							"text":   appointment.Title,
							"style":  "heading",
							"wrap":   true,
						},
						map[string]interface{}{
							"type": "TextBlock",
							"text": appointment.Message,
							"wrap": true,
						},
						map[string]interface{}{
							"type": "FactSet",
							"facts": []interface{}{
								map[string]interface{}{
									"title": "Datum",
									"value": appointment.BeginDateTime.In(loc).Format("02.01.2006"),
								},
								map[string]interface{}{
									"title": "Beginn",
									"value": appointment.BeginDateTime.In(loc).Format("15:04"),
								},
								map[string]interface{}{
									"title": "Ende",
									"value": appointment.EndDateTime.In(loc).Format("15:04"),
								},
								map[string]interface{}{
									"title": "Ort",
									"value": "Teams",
								},
							},
						},
					},
					"actions": []interface{}{
						map[string]interface{}{
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
	req, err := http.NewRequest(http.MethodPost, webhook_url, bytes.NewReader(jsonData))
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
	log.Printf("Appointment reminder sent. Response: `%s`", body)
	return nil
}

func generateUniqueID(notificationTime time.Time, reminder Appointment) string {
	return uuid.NewSHA1(uuid.Nil,
		[]byte(fmt.Sprintf("%s-%s-%s",
			notificationTime.Format(time.RFC3339), reminder.BeginDateTime.Format(time.RFC3339), reminder.Title))).String()
}

func appointmentExists(appointment Appointment) (bool, error) {
	var rowCount int
	appointment_rows, err := db.Query(`
        SELECT COUNT(*) FROM appointments WHERE begin_datetime = ? AND title = ?;
    `, appointment.BeginDateTime, appointment.Title)
	if err != nil {
		return false, err
	}
	defer appointment_rows.Close()
	appointment_rows.Scan(&rowCount)
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
	for _, duration := range appointment.Reminders {
		if duration < 0 {
			sendAppointmentReminder(appointment)
			continue
		}
		notificationTime := appointment.BeginDateTime.Add(time.Duration(-duration) * time.Second)
		timeUntilNotification := time.Until(notificationTime)
		if timeUntilNotification < 0 {
			continue
		}
		timer := time.AfterFunc(timeUntilNotification, func() {
			sendAppointmentReminder(appointment)
			log.Printf("%s: %s", timeUntilNotification, appointment.Title)
		})
		reminderID := generateUniqueID(notificationTime, appointment)
		log.Printf("Reminding %d secs before appointment (%v), current time: %v, time until notification: %v, ID: %s",
			duration, notificationTime, time.Now(), timeUntilNotification, reminderID)
		timers[reminderID] = &TimerData{Timer: timer, ID: reminderID, Appointment: appointment}
		scheduledReminders = append(scheduledReminders, ReminderInfo{reminderID, notificationTime})
	}
	return scheduledReminders, nil
}

func handleReminderSchedule(w http.ResponseWriter, r *http.Request) {
	var appointment Appointment
	if err := json.NewDecoder(r.Body).Decode(&appointment); err != nil {
		log.Printf("Decoding JSON data failed with %s", err.Error())
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var success bool = true
	var errMsg string
	removeDuplicateReminders(&appointment)
	scheduledReminders, err := scheduleReminders(appointment)
	if err != nil {
		log.Printf("Scheduling reminders() failed: %v", err)
		success = false
		errMsg = err.Error()
	}
	if err := saveAppointment(appointment); err != nil {
		log.Printf("Saving appointment failed: %v", err)
		success = false
		errMsg = err.Error()
	}
	response := map[string]interface{}{
		"success":   success,
		"error":     errMsg,
		"reminders": scheduledReminders,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func cancelTimer(id string) error {
	log.Printf("Cancelling timer %s", id)
	if timerInfo, ok := timers[id]; ok {
		if timerInfo.Timer.Stop() {
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
	for _, duration := range appointment.Reminders {
		notificationTime := appointment.BeginDateTime.Add(time.Duration(-duration) * time.Second)
		reminderID := generateUniqueID(notificationTime, appointment)
		if err := cancelTimer(reminderID); err != nil {
			continue
		}
		canceledReminders = append(canceledReminders, ReminderInfo{reminderID, notificationTime})
	}
	return canceledReminders, nil
}

func handleReminderCancel(w http.ResponseWriter, r *http.Request) {
	var appointment Appointment
	if err := json.NewDecoder(r.Body).Decode(&appointment); err != nil {
		log.Printf("Decoding JSON data failed with %s", err.Error())
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	canceledReminders, err := cancelReminders(appointment)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}
	err = deleteAppointment(appointment)
	if err != nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}
	sendAppointmentCancellation(appointment)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"reminders": canceledReminders,
	})
}

func createTables(db *sql.DB) error {
	var err error
	_, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY,
            begin_datetime DATETIME NOT NULL,
            end_datetime DATETIME NOT NULL,
            title TEXT NOT NULL,
            message TEXT,
            channel_url TEXT,
			reminders TEXT
        );
		CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_title_datetime
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
		appointments = append(appointments, a)
	}
	return appointments, nil
}

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("Error loading .env file: %v", err)
	}
	webhook_url = os.Getenv("WEBHOOK_URL")

	loc, err = time.LoadLocation("Europe/Berlin")
	if err != nil {
		log.Fatalf("Error loading location: %v", err)
	}

	db, err = sql.Open("sqlite3", "./appointments.db")
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

	r := http.NewServeMux()
	endpoints := []Endpoint{
		{os.Getenv("API_ENDPOINT_SCHEDULE"), handleReminderSchedule},
		{os.Getenv("API_ENDPOINT_CANCEL"), handleReminderCancel},
	}
	for _, endpoint := range endpoints {
		log.Printf("Serving http://%s:%s%s ...\n", os.Getenv("HOST"), os.Getenv("PORT"), endpoint.path)
		r.HandleFunc(endpoint.path, endpoint.handler)
	}

	srv := &http.Server{
		Addr:    os.Getenv("HOST") + ":" + os.Getenv("PORT"),
		Handler: r,
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
	for _, timer := range timers {
		if timer.Timer.Stop() {
			log.Printf("Timer for reminder %s canceled successfully", timer.ID)
		} else {
			log.Printf("Timer for reminder %s already expired or stopped", timer.ID)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server Shutdown Failed: %+v", err)
	}
	log.Println("Server exited gracefully.")
}
