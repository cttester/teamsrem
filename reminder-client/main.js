(function (window) {
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
    const API = {
        ENDPOINT: {
            SCHEDULE: "http://127.0.0.1:3421/api/v1/appointment/schedule",
            CANCEL: "http://127.0.0.1:3421/api/v1/appointment/cancel",
        }
    };
    const CONFIG = {
        REQUEST_TIMEOUT_MS: 10000,
        STATUS_TIMEOUT_MS: 2000,
        FADEOUT_MS: 300,
    };
    const MILLISECONDS = 1000;

    class TimeSpanSelector extends HTMLElement {
        static observedAttributes = ["reminders", "date-time"];
        static formAssociated = true;
        static DELETE_STRING = "löschen";
        static UNITS = {
            s: 1,
            m: 60,
            h: 60 * 60,
            d: 24 * 60 * 60,
        };
        static UNIT_NAMES = {
            s: "Sekunde(n)",
            m: "Minute(n)",
            h: "Stunde(n)",
            d: "Tag(e)",
        };
        static DEFAULT_REMINDERS = [
            { n: 30, unit: "s" },
            { n: 10, unit: "m" },
            { n: 1, unit: "h" },
            { n: 24, unit: "h" },
            { n: -1, unit: "s" },
        ];
        constructor() {
            super();
            this._internals = this.attachInternals();
        }
        get valid() {
            return this._internals.states.has("valid");
        }
        get reminders() {
            return Object.values(this._reminders).map(r => r.n * TimeSpanSelector.UNITS[r.unit]);
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
    --plus-size: 20px;
}
.plus {
    display: inline-block;
    width: var(--plus-size);
    height: var(--plus-size);
    border-radius: 50%;
    background-color: transparent;
    border: calc(var(--plus-size) / 10) solid var(--dark-color);
    color: var(--dark-color);
    text-align: center;
    cursor: pointer;
    position: relative;
}
.plus:before{
    position: absolute;
    top: -3px;
    left: 0;
    content: '\uFF0B';
    font-size: calc(var(--plus-size) / 1.3);
}
.plus:hover {
    background-color: var(--medium-color);
}
`;
            this._shadow.appendChild(style);
            this._body = document.createElement("body");
            this._shadow.appendChild(this._body);
            this._t0 = new Date(this.getAttribute("date-time"));
            this._reminders = Object.fromEntries(JSON.parse(this.getAttribute("reminders") || "[]").map(k => [crypto.randomUUID(), k]));
            const plus = document.createElement("div");
            plus.className = "plus";
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
                this._reminders[uuid] = reminder;
            }
            const div = document.createElement("div");
            div.setAttribute("data-uuid", uuid);
            const inputNumber = document.createElement("input");
            inputNumber.addEventListener("change", e => {
                const uuid = e.target.parentNode.getAttribute("data-uuid");
                this._reminders[uuid].n = parseInt(e.target.value);
                this.checkValidity();
                this._emitChangeEvent();
            });
            inputNumber.type = "number";
            inputNumber.value = reminder.n;
            const selectUnit = document.createElement("select");
            selectUnit.addEventListener("change", e => {
                const uuid = e.target.parentNode.getAttribute("data-uuid");
                const node = this._shadow.querySelector(`[data-uuid="${uuid}"]`);
                if (e.target.value === TimeSpanSelector.DELETE_STRING) {
                    node.remove();
                    delete this._reminders[uuid];
                }
                else {
                    this._reminders[uuid].unit = e.target.value;
                }
                this.checkValidity();
                this._emitChangeEvent();
            });
            for (const [unit, secs] of Object.entries(TimeSpanSelector.UNITS)) {
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
                    inputs[i + 1].classList.remove("invalid");
                    inputs[i].title = "";
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
            for (const uuid in this._reminders) {
                const reminder = this._reminders[uuid];
                const div = this.addReminder(reminder, uuid);
                divs.push(div);
            }
            this._body.replaceChildren(...divs);
        }
    }


    const el = {};
    let abortController = null;

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

    function onDocumentClicked() {
        hideStatus();
        if (abortController) {
            abortController.abort();
            abortController = null;
            console.log("Senden abgebrochen.");
        }
    }

    function mkAppointmentObject() {
        const t0 = mkDate(el.date.value, el.startTime.value);
        const t1 = mkDate(el.date.value, el.endTime.value);
        return {
            "begin_datetime": `${t0.toISOString()}`,
            "end_datetime": `${t1.toISOString()}`,
            "title": el.title.value,
            "message": el.message.value,
            "channel_url": el.channelUrl.value,
            "reminders": el.timeSpanSelector.reminders,
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
            && el.timeSpanSelector.valid
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
            checkForm();
            if (el.startTime.value !== "")
                el.timeSpanSelector.setAttribute("date-time", mkDate(e.target.value, el.startTime.value).toISOString());
            localStorage.setItem(LOCALSTORAGE.KEY.DATE, e.target.value);
        });
        el.startTime = document.querySelector("#start-time");
        el.startTime.addEventListener("input", e => {
            checkForm();
            if (el.date.value !== "")
                el.timeSpanSelector.setAttribute("date-time", mkDate(el.date.value, e.target.value).toISOString());
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
        el.timeSpanSelector = document.querySelector("timespan-selector");
        el.timeSpanSelector.addEventListener("change", e => {
            checkForm();
            localStorage.setItem(LOCALSTORAGE.KEY.REMINDERS, JSON.stringify(e.target.reminders));
        });
        restoreForm();
        checkForm();
    }

    window.addEventListener("load", main);
})(window);
