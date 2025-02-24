// Copyright (c) 2024 Heise Medien GmbH & Co. KG, Oliver Lau <ola@ct.de>

(function (window) {
    const HOSTNAME = window.location.hostname;
    const PORT = 3421;
    const MILLISECONDS = 1000;
    const API = {
        ENDPOINT: `http://${HOSTNAME}:${PORT}/api/v1/appointment`,
    };
    console.debug(API.ENDPOINT);
    const LOCALSTORAGE = {
        KEY: {
            TITLE: "teams-reminder-title",
            MESSAGE: "teams-reminder-message",
            DATE: "teams-reminder-date",
            START_TIME: "teams-reminder-start-time",
            END_TIME: "teams-reminder-end-time",
            CHANNEL_URL: "teams-reminder-channel-url",
            REMINDERS: "teams-reminder-reminders",
        },
    };
    const CONFIG = {
        REQUEST_TIMEOUT_MS: 10 * MILLISECONDS,
        STATUS_TIMEOUT_MS: 2 * MILLISECONDS,
        FADEOUT_MS: 300,
    };

    class TimeSpanSelector extends HTMLElement {
        static observedAttributes = ["reminders", "date-time"];
        static formAssociated = true;
        static DELETE_STRING = "löschen";
        static IMMEDIATELY = "immediately";
        static UNITS = {
            s: 1,
            m: 60,
            h: 60 * 60,
            d: 24 * 60 * 60,
            [TimeSpanSelector.IMMEDIATELY]: -1,
        };
        static UNIT_NAMES = {
            s: "Sekunde(n)",
            m: "Minute(n)",
            h: "Stunde(n)",
            d: "Tag(e)",
        };
        constructor() {
            super();
            this._internals = this.attachInternals();
            this._reminders = {}; // { uuid: { n: Number, unit: String } }
        }
        get valid() {
            return this._internals.states.has("valid");
        }
        get reminders() {
            return Object.values(this._reminders);
        }
        connectedCallback() {
            this._shadow = this.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = `
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}
input[type="number"] {
    width: 5em;
    padding-right: 0.2em;
    text-align: right;
}
input, select {
    padding: 0.5ex 0.5em;
    font-family: Arial, Helvetica, sans-serif;
}
div {
    margin-bottom: 4px;
}
.invalid, input:invalid {
    color: red;
    outline: 2px solid red;
}
.invalid + span.too-early:after, input:invalid + span.validity {
    margin-left: 0.5em;
}
.invalid + span.too-early:after {
    content: 'Zeitpunkt liegt in der Vergangenheit';
    color: red;
    font-size: smaller;
    font-weight: bold;
}
:host {
    --plus-size: 22px;
}
.plus {
    display: inline-block;
    width: var(--plus-size);
    height: var(--plus-size);
    border-radius: 50%;
    background-color: transparent;
    cursor: pointer;
    border: none;
}
.plus:focus {
    outline: 4px solid var(--highlight-color);
    outline-offset: 3px;
}
.plus > svg {
    fill: var(--dark-color);
}
.plus:hover {
    background-color: rgb(from var(--medium-color) r g b / 50%);
}
.plus:hover > svg {
    fill: rgb(from var(--dark-color) r g b / 80%);
}
`;
            this._shadow.appendChild(style);
            this._body = document.createElement("body");
            this._shadow.appendChild(this._body);
            this._t0 = new Date(this.getAttribute("date-time"));
            this._reminders = Object.fromEntries(JSON.parse(this.getAttribute("reminders") || "[]").map(k => [crypto.randomUUID(), k]));
            const plus = document.createElement("button");
            plus.setAttribute("aria-label", "Erinnerungszeitpunkt hinzufügen");
            plus.className = "plus";
            plus.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 11.355 11.355" version="1.1" xmlns="http://www.w3.org/2000/svg">
              <path d="M5.678,11.355c3.135,0 5.677,-2.543 5.677,-5.677c0,-3.135 -2.543,-5.678 -5.677,-5.678c-3.135,0 -5.678,2.543 -5.678,5.678c-0,3.135 2.543,5.677 5.678,5.677Zm0,-1c-2.584,-0 -4.67,-2.092 -4.67,-4.676c-0,-2.584 2.086,-4.676 4.67,-4.676c2.584,-0 4.676,2.092 4.676,4.676c-0,2.584 -2.092,4.676 -4.676,4.676Zm-2.573,-4.676c0,0.281 0.206,0.474 0.493,0.474l1.593,0l0,1.6c0,0.287 0.2,0.486 0.475,0.486c0.293,0 0.492,-0.199 0.492,-0.486l0,-1.6l1.6,0c0.281,0 0.486,-0.193 0.486,-0.474c0,-0.287 -0.199,-0.492 -0.486,-0.492l-1.6,-0l0,-1.588c0,-0.293 -0.199,-0.493 -0.492,-0.493c-0.275,0 -0.475,0.2 -0.475,0.493l0,1.588l-1.593,-0c-0.293,-0 -0.493,0.205 -0.493,0.492Z" style="fill-rule:nonzero;"/>
            </svg>`;
            plus.addEventListener("click", _e => {
                const div = this.addReminder({ n: 1, unit: "m" });
                this._body.appendChild(div);
                this._emitChangeEvent();
            });
            this._shadow.appendChild(plus);
        }
        attributeChangedCallback(name, _oldValue, newValue) {
            switch (name) {
                case "reminders":
                    this._reminders = Object.fromEntries(JSON.parse(newValue).map(k => [crypto.randomUUID(), k]));
                    this._buildReminders();
                    this.checkValidity();
                    break;
                case "date-time":
                    this._t0 = new Date(newValue);
                    this.checkValidity();
                    break;
                default: break;
            }
        }
        addReminder(reminder, uuid) {
            if (typeof uuid === "undefined") {
                uuid = crypto.randomUUID();
            }
            this._reminders[uuid] = reminder;
            const div = document.createElement("div");
            div.setAttribute("data-uuid", uuid);
            const inputNumber = document.createElement("input");
            inputNumber.type = "number";
            inputNumber.min = 0;
            if (reminder.unit === TimeSpanSelector.IMMEDIATELY) {
                inputNumber.disabled = true;
                inputNumber.value = 0;
            }
            else {
                inputNumber.value = reminder.n;
            }
            inputNumber.addEventListener("change", e => {
                const uuid = e.target.parentNode.getAttribute("data-uuid");
                this._reminders[uuid].n = parseInt(e.target.value);
                this.checkValidity();
                this._emitChangeEvent();
            });
            const selectUnit = document.createElement("select");
            selectUnit.addEventListener("change", e => {
                const uuid = e.target.parentNode.getAttribute("data-uuid");
                const node = this._shadow.querySelector(`[data-uuid="${uuid}"]`);
                switch (e.target.value) {
                    case TimeSpanSelector.DELETE_STRING:
                        node.remove();
                        delete this._reminders[uuid];
                        break;
                    case TimeSpanSelector.IMMEDIATELY:
                        this._reminders[uuid] = { n: 1, unit: TimeSpanSelector.IMMEDIATELY };
                        inputNumber.disabled = true;
                        break;
                    default:
                        this._reminders[uuid].unit = e.target.value;
                        inputNumber.disabled = false;
                        break;
                }
                this.checkValidity();
                this._emitChangeEvent();
            });
            const optionNow = document.createElement("option");
            optionNow.value = TimeSpanSelector.IMMEDIATELY;
            optionNow.textContent = "sofort";
            selectUnit.appendChild(optionNow);
            for (const [unit, secs] of Object.entries(TimeSpanSelector.UNITS)) {
                if (unit === TimeSpanSelector.IMMEDIATELY)
                    continue;
                const optionUnit = document.createElement("option");
                optionUnit.value = unit;
                optionUnit.textContent = TimeSpanSelector.UNIT_NAMES[unit];
                optionUnit.selected = (unit == reminder.unit);
                optionUnit.setAttribute("data-secs", secs);
                selectUnit.appendChild(optionUnit);
            }
            const optionDelete = document.createElement("option");
            optionDelete.value = TimeSpanSelector.DELETE_STRING;
            optionDelete.textContent = "löschen";
            selectUnit.appendChild(optionDelete);
            const afterSpan = document.createElement("span");
            afterSpan.className = "too-early";
            div.append(inputNumber, selectUnit, afterSpan);
            return div;
        }
        checkValidity() {
            const inputs = this._body.querySelectorAll("input, select");
            const now = new Date();
            let ok = true;
            for (let i = 0; i < inputs.length; i += 2) {
                const dt = 1000 * parseInt(inputs[i].value) * parseInt(inputs[i + 1].options[inputs[i + 1].selectedIndex].getAttribute("data-secs"));
                if (this._t0.getTime() - dt < now) {
                    inputs[i].classList.add("invalid");
                    inputs[i].title = "Zeitpunkt liegt in der Vergangenheit";
                    inputs[i + 1].classList.add("invalid");
                    inputs[i + 1].title = "Zeitpunkt liegt in der Vergangenheit";
                    ok = false;
                }
                else {
                    inputs[i].classList.remove("invalid");
                    inputs[i].title = "";
                    inputs[i + 1].classList.remove("invalid");
                    inputs[i + 1].title = "";
                }
            }
            if (ok) {
                this._internals.states.add("valid");
            }
            else {
                this._internals.states.delete("valid");
            }
            return ok;
        }
        _emitChangeEvent() {
            this.dispatchEvent(new Event("change"));
        }
        _buildReminders() {
            let divs = [];
            for (const [uuid, reminder] of Object.entries(this._reminders)) {
                const div = this.addReminder(reminder, uuid);
                divs.push(div);
            }
            this._body.replaceChildren(...divs);
        }
    }


    const el = {};
    let abortController = null;
    let checkInterval;

    function showStatus(msg, options = { withProgressBar: false, error: false }) {
        el.statusDialog.showModal();
        el.statusText.innerHTML = msg;
        if (options.error) {
            el.statusText.classList.add("error");
        }
        else {
            el.statusText.classList.remove("error");
        }
        if (options.withProgressBar) {
            el.statusDialog.classList.add("with-progress-bar");
        }
        else {
            el.statusDialog.classList.remove("with-progress-bar");
        }
        disableForm();
    }

    function hideStatus() {
        if (!el.statusDialog.open)
            return;
        el.statusDialog.close();
        enableForm();
    }

    function disableForm() {
        el.submitButton.disabled = true;
        el.cancelButton.disabled = true;
    }

    function enableForm() {
        el.submitButton.disabled = false;
        el.cancelButton.disabled = false;
    }

    function restoreForm() {
        if (localStorage.getItem(LOCALSTORAGE.KEY.TITLE)) {
            el.title.value = localStorage.getItem(LOCALSTORAGE.KEY.TITLE);
        }
        if (localStorage.getItem(LOCALSTORAGE.KEY.MESSAGE)) {
            el.message.value = localStorage.getItem(LOCALSTORAGE.KEY.MESSAGE);
        }
        if (localStorage.getItem(LOCALSTORAGE.KEY.DATE)) {
            el.date.value = localStorage.getItem(LOCALSTORAGE.KEY.DATE);
        }
        if (localStorage.getItem(LOCALSTORAGE.KEY.START_TIME)) {
            el.startTime.value = localStorage.getItem(LOCALSTORAGE.KEY.START_TIME);
        }
        if (localStorage.getItem(LOCALSTORAGE.KEY.END_TIME)) {
            el.endTime.value = localStorage.getItem(LOCALSTORAGE.KEY.END_TIME);
        }
        if (localStorage.getItem(LOCALSTORAGE.KEY.CHANNEL_URL)) {
            el.channelUrl.value = localStorage.getItem(LOCALSTORAGE.KEY.CHANNEL_URL);
        }
        let reminders;
        if (localStorage.getItem(LOCALSTORAGE.KEY.REMINDERS)) {
            try {
                reminders = localStorage.getItem(LOCALSTORAGE.KEY.REMINDERS);
            }
            catch (e) {
                console.error(e);
            }
        }
        if (reminders)
            el.timeSpanSelector.setAttribute("reminders", reminders);
        if (el.date.value !== "" && el.startTime.value !== "")
            el.timeSpanSelector.setAttribute("date-time", mkLocalDate(el.date.value, el.startTime.value).toISOString());

        const invalidField = el.form.querySelector(":invalid");
        if (invalidField)
            invalidField.focus();
    }

    function onKeyUp(e) {
        if (e.key === "Escape")
            document.querySelector("#help-floater").classList.add("hidden");
    }

    function onDocumentClicked() {
        hideStatus();
        document.querySelector("#help-floater").classList.add("hidden");
        if (abortController) {
            abortController.abort();
            abortController = null;
            console.log("Senden abgebrochen.");
        }
    }

    function mkAppointmentObject() {
        const t0 = mkLocalDate(el.date.value, el.startTime.value);
        const t1 = mkLocalDate(el.date.value, el.endTime.value);
        console.debug(el.timeSpanSelector.reminders);
        return {
            "begin_datetime": `${t0.toISOString()}`,
            "end_datetime": `${t1.toISOString()}`,
            "title": el.title.value,
            "message": el.message.value,
            "channel_url": el.channelUrl.value,
            "reminders": el.timeSpanSelector.reminders.map(r => r.n * TimeSpanSelector.UNITS[r.unit]),
        };
    }

    function onCancel(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showStatus("Ereignis wird abgesagt &hellip;", { withProgressBar: true });
        const appointment_data = mkAppointmentObject();
        abortController = new AbortController();
        const signal = AbortSignal.any([AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT_MS), abortController.signal]);
        fetch(API.ENDPOINT,
            {
                method: "DELETE",
                body: JSON.stringify(appointment_data),
                headers: {
                    "Content-Type": "application/json",
                },
                signal,
            }
        ).catch(err => {
            showStatus(`Senden fehlgeschlagen: ${err}`);
        }).then(res => {
            if (!res)
                return;
            if (res.ok) {
                res.json().then(result => {
                    if (result.success) {
                        if (result.reminders && result.reminders.length > 0) {
                            showStatus(`Senden erfolgreich. ${result.reminders.length} Erinnerungen gelöscht.`);
                            setTimeout(hideStatus, CONFIG.STATUS_TIMEOUT_MS);
                        }
                        else {
                            showStatus("Es wurden keine Ereignisse zum Absagen gefunden.");
                        }
                    }
                    else {
                        showStatus(`Absagen des Ereignisses fehlgeschlagen: ${result.error}`, { error: true })
                    }
                });
            }
            else {
                res.json().then(json => {
                    showStatus(`Senden fehlgeschlagen mit Code ${res.status}: ${json.error.message}`, { error: true });
                }).catch(err => console.error("Senden fehlgeschlagen.", err));
            }
        });
        return true;
    }

    function onSubmit(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showStatus("Erinnerungen werden eingerichtet &hellip;", { withProgressBar: true });
        const appointment_data = mkAppointmentObject();
        console.debug(appointment_data);
        abortController = new AbortController();
        const signal = AbortSignal.any([AbortSignal.timeout(20000), abortController.signal]);
        fetch(API.ENDPOINT,
            {
                method: "POST",
                body: JSON.stringify(appointment_data),
                headers: {
                    "Content-Type": "application/json",
                },
                signal,
            }
        ).catch(err => {
            showStatus(`Senden fehlgeschlagen: ${err}`);
        }).then(res => {
            if (!res)
                return;
            if (res.ok) {
                res.json().then(result => {
                    if (result.success) {
                        showStatus("Senden erfolgreich.");
                        setTimeout(hideStatus, CONFIG.STATUS_TIMEOUT_MS);
                    }
                    else {
                        showStatus(`Anlegen von Erinnerungen fehlgeschlagen: ${result.error}`, { error: true });
                    }
                    abortController = null;
                });
            }
            else {
                res.json().then(json => {
                    showStatus(`Senden fehlgeschlagen mit Code ${res.status}: ${json.error.message}`, { error: true });
                    abortController = null;
                }).catch(err => console.error("Senden fehlgeschlagen.", err));
            }
        });
        return false;
    }

    function mkLocalDate(dateString, timeString) {
        const [year, month, day] = dateString.split('-').map(Number);
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date(year, month - 1, day, hours, minutes);
        return date;
    }

    const dateFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
    const timeFormatter = new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit", hourCycle: 'h24' });

    function nowDateTime() {
        const now = new Date;
        return [
            dateFormatter.format(now),
            timeFormatter.format(now),
        ];
    }

    function checkForm() {
        let ok = true;
        // check for plausible date
        const [nowYYYYMMDD, nowHHmm] = nowDateTime();
        if (el.date.value !== "" && nowYYYYMMDD > el.date.value) {
            el.date.classList.add("invalid");
            el.date.nextElementSibling.textContent = "Das Datum liegt in der Vergangenheit.";
            ok = false;
        }
        else {
            el.date.classList.remove("invalid");
            el.date.nextElementSibling.textContent = "";
        }
        if (nowYYYYMMDD === el.date.value) {
            // check for valid start time
            if (el.startTime.value !== "" && nowHHmm >= el.startTime.value) {
                el.startTime.classList.add("invalid");
                el.startTime.nextElementSibling.textContent = "Die Uhrzeit liegt in der Vergangenheit.";
                ok = false;
            }
            else {
                el.startTime.classList.remove("invalid");
                el.startTime.nextElementSibling.textContent = "";
            }
            // check for valid start time
            if (el.endTime.value !== "" && nowHHmm >= el.endTime.value) {
                el.endTime.classList.add("invalid");
                el.endTime.nextElementSibling.textContent = "Die Uhrzeit liegt in der Vergangenheit.";
                ok = false;
            }
            else {
                el.endTime.classList.remove("invalid");
                el.endTime.nextElementSibling.textContent = "";
            }
        }
        // check if end time is after start time
        if (el.date.value !== "" && el.startTime.value !== "" && el.endTime.value !== ""
            && `${el.date.value}T${el.startTime.value}` > `${el.date.value}T${el.endTime.value}`) {
            el.startTime.classList.add("invalid");
            el.endTime.classList.add("invalid");
            el.startTime.nextElementSibling.textContent = "Start darf nicht nach dem Ende sein.";
            ok = false;
        }
        else {
            el.startTime.classList.remove("invalid");
            el.endTime.classList.remove("invalid");
            el.startTime.nextElementSibling.textContent = "";
        }
        if (
            ok
            && el.form.checkValidity()
            && el.timeSpanSelector.checkValidity()
        ) {
            enableForm();
        }
        else {
            disableForm();
        }
    }

    function main() {
        console.info("%cErinnerungshelferlein für Teams", "font-weight: bold; color: #14315b;");
        customElements.define("timespan-selector", TimeSpanSelector);
        el.form = document.querySelector("form");
        el.title = document.querySelector("#title");
        el.title.addEventListener("input", e => {
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.TITLE, e.target.value);
        });
        el.message = document.querySelector("#message");
        el.message.addEventListener("input", e => {
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.MESSAGE, e.target.value);
        });
        el.date = document.querySelector("#date");
        el.date.addEventListener("input", e => {
            if (el.startTime.value !== "")
                el.timeSpanSelector.setAttribute("date-time", mkLocalDate(e.target.value, el.startTime.value).toISOString());
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.DATE, e.target.value);
        });
        const [nowDateISO, _] = nowDateTime();
        el.date.setAttribute("min", nowDateISO);
        el.startTime = document.querySelector("#start-time");
        el.startTime.addEventListener("input", e => {
            if (el.date.value !== "")
                el.timeSpanSelector.setAttribute("date-time", mkLocalDate(el.date.value, e.target.value).toISOString());
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.START_TIME, e.target.value);
        });
        el.startTime.addEventListener("invalid", disableForm);
        el.endTime = document.querySelector("#end-time");
        el.endTime.addEventListener("input", e => {
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.END_TIME, e.target.value);
        });
        el.channelUrl = document.querySelector("#channel-url");
        el.channelUrl.addEventListener("input", e => {
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.CHANNEL_URL, e.target.value);
        });
        el.submitButton = document.querySelector("#submit-button");
        el.submitButton.addEventListener("click", onSubmit);
        el.cancelButton = document.querySelector("#cancel-button");
        el.cancelButton.addEventListener("click", onCancel);
        el.statusDialog = document.querySelector("#status-dialog");
        el.statusText = el.statusDialog.querySelector(".status-text");
        document.addEventListener("click", onDocumentClicked);
        document.addEventListener("keyup", onKeyUp);
        el.timeSpanSelector = document.querySelector("timespan-selector");
        el.timeSpanSelector.addEventListener("change", e => {
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.REMINDERS, JSON.stringify(e.target.reminders));
        });
        restoreForm();
        checkForm();

        document.querySelectorAll(".help").forEach(element => {
            const helpFloater = document.querySelector("#help-floater");
            helpFloater.lastChild.addEventListener("click", _e => {
                helpFloater.classList.add("hidden");
            });
            const showHelp = e => {
                const html = document.querySelector(`#${element.dataset.topic}`).content.cloneNode(true);
                helpFloater.querySelector("div:first-child").replaceChildren(html);
                helpFloater.classList.remove("hidden");
                helpFloater.style.top = `${e.target.offsetTop + 10}px`;
                helpFloater.style.left = `calc(${e.target.offsetLeft}px + 1.5em + 10px)`;
            }
            element.addEventListener("mouseenter", showHelp);
        });

        document.addEventListener("visibilitychange", e => {
            if (e.target.visibilityState === "visible") {
                checkForm();
                checkInterval = setInterval(checkForm, 5000);
            }
            else {
                clearInterval(checkInterval);
            }
        });

        checkInterval = setInterval(checkForm, 5000);
    }

    window.addEventListener("load", main);
})(window);
