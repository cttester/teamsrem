// Copyright (c) 2024 Heise Medien GmbH & Co. KG, Oliver Lau <ola@ct.de>

(function (window) {
    const HOSTNAME = window.location.hostname;
    const PORT = 3421;
    const MILLISECONDS = 1000;
    const API = {
        ENDPOINT: {
            SCHEDULE: `http://${HOSTNAME}:${PORT}/api/v1/appointment/schedule`,
            CANCEL: `http://${HOSTNAME}:${PORT}/api/v1/appointment/cancel`,
        }
    };
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
            const plus = document.createElement("div");
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
        static async digestMessage(message) {
            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            const hash = await window.crypto.subtle.digest("SHA-256", data);
            return hash;
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
        el.form.classList.add("subtle");
        el.status.classList.add("visible");
        el.statusText.innerHTML = msg;
        if (options.error) {
            el.statusText.classList.add("error");
        }
        else {
            el.statusText.classList.remove("error");
        }
        if (options.withProgressBar) {
            el.status.classList.add("with-progress-bar");
        }
        else {
            el.status.classList.remove("with-progress-bar");
        }
        disableForm();
    }

    function hideStatus() {
        if (!el.status.classList.contains("visible"))
            return;
        setTimeout(() => {
            el.status.classList.remove("visible");
            el.status.classList.remove("fade-out");
        }, CONFIG.FADEOUT_MS);
        el.form.classList.remove("subtle");
        el.status.classList.add("fade-out");
        enableForm();
    }

    function disableForm(e) {
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
            el.timeSpanSelector.setAttribute("date-time", mkDate(el.date.value, el.startTime.value).toISOString());
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
        const t0 = mkDate(el.date.value, el.startTime.value);
        const t1 = mkDate(el.date.value, el.endTime.value);
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
        fetch(API.ENDPOINT.CANCEL,
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
        fetch(API.ENDPOINT.SCHEDULE,
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

    function mkDate(dateString, timeString) {
        const date = new Date(dateString);
        const [hours, minutes] = timeString.split(':').map(Number);
        const tzMS = date.getTimezoneOffset() * 60 * MILLISECONDS;
        const utc = date.getTime() + tzMS + (hours * 60 * 60 + minutes * 60) * MILLISECONDS;
        return new Date(utc);
    }

    function checkForm() {
        let ok = true;
        // check for plausible date
        const today = new Date();
        const todayDateISO = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
        const todayTimeISO = `${today.getHours().toString().padStart(2, "0")}:${today.getMinutes().toString().padStart(2, "0")}`;
        if (el.date.value !== "" && todayDateISO > el.date.value) {
            el.date.classList.add("invalid");
            el.date.nextSibling.textContent = "Das Datum liegt in der Vergangenheit.";
            ok = false;
        }
        else {
            el.date.classList.remove("invalid");
            el.date.nextSibling.textContent = "";
        }
        if (todayDateISO === el.date.value) {
            // check for valid start time
            if (el.startTime.value !== "" && todayTimeISO >= el.startTime.value) {
                el.startTime.classList.add("invalid");
                el.startTime.nextSibling.textContent = "Die Uhrzeit liegt in der Vergangenheit.";
                ok = false;
            }
            else {
                el.startTime.classList.remove("invalid");
                el.startTime.nextSibling.textContent = "";
            }
            // check for valid start time
            if (el.endTime.value !== "" && todayTimeISO >= el.endTime.value) {
                el.endTime.classList.add("invalid");
                el.endTime.nextSibling.textContent = "Die Uhrzeit liegt in der Vergangenheit.";
                ok = false;
            }
            else {
                el.endTime.classList.remove("invalid");
                el.endTime.nextSibling.textContent = "";
            }
        }
        // check if end time is after start time
        if (el.date.value !== "" && el.startTime.value !== "" && el.endTime.value !== ""
            && mkDate(el.date.value, el.startTime.value) > mkDate(el.date.value, el.endTime.value)) {
            el.startTime.classList.add("invalid");
            el.endTime.classList.add("invalid");
            el.startTime.nextSibling.textContent = "Start darf nicht nach dem Ende sein.";
            ok = false;
        }
        else {
            el.startTime.classList.remove("invalid");
            el.endTime.classList.remove("invalid");
            el.startTime.nextSibling.textContent = "";
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
                el.timeSpanSelector.setAttribute("date-time", mkDate(e.target.value, el.startTime.value).toISOString());
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.DATE, e.target.value);
        });
        el.startTime = document.querySelector("#start-time");
        el.startTime.addEventListener("input", e => {
            if (el.date.value !== "")
                el.timeSpanSelector.setAttribute("date-time", mkDate(el.date.value, e.target.value).toISOString());
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
        el.status = document.querySelector("#status");
        el.statusText = el.status.querySelector(".status-text");
        const extraStyles = document.createElement("style");
        extraStyles.textContent = `:root { --fadeout-ms: ${CONFIG.FADEOUT_MS}ms; }`;
        document.querySelector("head").appendChild(extraStyles);
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
                helpFloater.firstChild.replaceChildren(html);
                helpFloater.classList.remove("hidden");
                helpFloater.style.top = `${e.target.offsetTop + 10}px`;
                helpFloater.style.left = `calc(${e.target.offsetLeft}px + 1.5em + 10px)`;
            }
            element.addEventListener("mouseenter", showHelp);
        });

        window.addEventListener("visibilitychange", e => {
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
