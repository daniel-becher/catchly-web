// Catchly voice widget for the English clinic demos (Vapi).
// Each demo page calls mountReceptionist(CLINIC) with the clinic's facts.
// The assistant is defined inline, so no Vapi dashboard assistant is needed.
import Vapi from "https://esm.sh/@vapi-ai/web@2";

const PUBLIC_KEY = "d827fc1d-d429-4a5a-a9f7-ce4e281f668d";

const STATUS = {
  connecting: "Connecting, your browser will ask for the microphone…",
  live:       "You're live. Talk normally, you can interrupt it any time.",
  speaking:   "Receptionist is speaking…",
  listening:  "Listening…",
  ended:      "Call ended. Thanks for trying it.",
  errMic:     "Your browser blocked the microphone. Allow it in the address bar and try again.",
  errNoMic:   "We couldn't find a microphone. Check that one is connected.",
  errBusy:    "All lines are busy right now. Please try again in a moment.",
  errGeneric: "Something went wrong. Please try again.",
};

function buildAssistant(c) {
  return {
    name: c.name + " receptionist",
    firstMessage: `Hi, thanks for calling ${c.name}! Just so you know, I'm the automated assistant. How can I help you today?`,
    transcriber: { provider: "deepgram", model: "nova-2", language: "en-US" },
    voice: { provider: "vapi", voiceId: "Paige" },
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [{ role: "system", content:
`You are the friendly phone receptionist for ${c.name}. You answer calls the front desk can't pick up.

What you know about the clinic:
${c.facts}

How to behave:
- Sound warm, natural and brief, like a great front desk person. One or two sentences at a time.
- Answer questions only from the facts above. If you don't know something, say the team will confirm it when they call back. Never make up prices, hours or treatments.
- Never give medical advice. For anything medical (side effects beyond what's listed, whether a treatment is right for them, pregnancy, medications) say a provider will answer that personally.
- If the caller wants to book, reschedule, or needs anything the team must handle, collect their first name, phone number, and what they're interested in. Repeat the phone number back to confirm it.
- Then tell them the team will call them back, usually the same or next business day.
- If the caller asks for a real person, say you'll pass the message on right away and take their name and number.
- Keep the call short. When everything is done, thank them and say goodbye.` }],
    },
    endCallPhrases: ["goodbye", "bye bye", "have a great day"],
  };
}

export function mountReceptionist(clinic) {
  const buttons   = Array.from(document.querySelectorAll("[data-catchly-call]"));
  const statusEls = Array.from(document.querySelectorAll("[data-catchly-status]"));
  const original  = new WeakMap();
  buttons.forEach((b) => original.set(b, b.innerHTML));

  let vapi = null, isActive = false, isBusy = false;
  const setStatus = (t) => statusEls.forEach((el) => { el.textContent = t; });

  function render(state) {
    buttons.forEach((btn) => {
      btn.disabled = isBusy;
      if (state === "active")          btn.innerHTML = '<span class="catchly-live-dot"></span>End call';
      else if (state === "connecting") btn.textContent = "Connecting…";
      else if (state === "ending")     btn.textContent = "Ending…";
      else                             btn.innerHTML = original.get(btn);
    });
  }

  function fail(msg) { isActive = false; isBusy = false; setStatus(msg); render("idle"); }

  try { vapi = new Vapi(PUBLIC_KEY); }
  catch (err) {
    console.error("[catchly] Init failed:", err);
    buttons.forEach((b) => { b.disabled = true; });
    setStatus(STATUS.errGeneric);
    return;
  }

  vapi.on("call-start",   () => { isActive = true;  isBusy = false; setStatus(STATUS.live);  render("active"); });
  vapi.on("call-end",     () => { isActive = false; isBusy = false; setStatus(STATUS.ended); render("idle"); });
  vapi.on("speech-start", () => { if (isActive) setStatus(STATUS.speaking); });
  vapi.on("speech-end",   () => { if (isActive) setStatus(STATUS.listening); });
  vapi.on("error", (err) => {
    console.error("[catchly] Error:", err);
    const raw = String(err?.errorMsg || err?.message || err || "");
    if (/permission|denied|NotAllowed/i.test(raw))              return fail(STATUS.errMic);
    if (/NotFound|no.*(device|microphone)/i.test(raw))          return fail(STATUS.errNoMic);
    if (/concurren|limit|exceed|quota|insufficient/i.test(raw)) return fail(STATUS.errBusy);
    if (/eject|ejection|meeting.*ended/i.test(raw))             return fail(STATUS.ended);
    fail(STATUS.errGeneric);
  });

  buttons.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (isBusy) return;
      if (isActive) {
        isBusy = true; render("ending");
        try { await vapi.stop(); } catch (err) { console.error(err); isActive = false; isBusy = false; render("idle"); }
        return;
      }
      isBusy = true; setStatus(STATUS.connecting); render("connecting");
      try { await vapi.start(buildAssistant(clinic)); }
      catch (err) {
        console.error("[catchly] Start failed:", err);
        if (/permission|denied|NotAllowed/i.test(String(err?.message || err))) return fail(STATUS.errMic);
        fail(STATUS.errGeneric);
      }
    });
  });

  window.addEventListener("pagehide", () => { if (isActive) { try { vapi.stop(); } catch (_) {} } });
}
