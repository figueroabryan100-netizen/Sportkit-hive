import { esc, money } from "/js/app.js?v=6";
import qrcode from "/vendor/qrcode/qrcode.mjs";

export function payPanel(o, pm) {
  const amt = money(o.total);
  const copy = (v) => `<button type="button" data-copy="${esc(v)}">Copy</button>`;
  let body = "";
  if (pm.kind === "link") body = `<p>Tap the button to pay securely. Enter <b>${esc(o.code)}</b> in the note if it asks.</p><a class="btn btn-lime" href="${esc(pm.link)}" target="_blank" rel="noopener">Pay ${amt} with ${esc(pm.label.split(" (")[0])} &nearr;</a>`;
  if (pm.kind === "handle") body = `<p>Send <b>${amt}</b> to:</p><div class="handle">${esc(pm.handle)} ${copy(pm.handle)}</div><p>Put <b>${esc(o.code)}</b> in the payment note.</p>${pm.link ? `<a class="btn btn-lime" href="${esc(pm.link)}" target="_blank" rel="noopener">Open ${esc(pm.label)} &nearr;</a>` : ""}`;
  if (pm.kind === "crypto") {
    const qr = qrcode(0, "M"); qr.addData(pm.handle); qr.make();
    body = `<p>Send the equivalent of <b>${amt}</b> in ${esc(pm.label)} to this address:</p><div class="qr" aria-label="QR code of the wallet address">${qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })}</div><div class="handle" style="font-size:13px">${esc(pm.handle)} ${copy(pm.handle)}</div><p style="font-size:13px;color:var(--mute)">Double check the network before sending. Crypto payments can't be reversed.</p>`;
  }
  if (pm.kind === "manual") body = `<p>Amount: <b>${amt}</b>. Reference: <b>${esc(o.code)}</b> ${copy(o.code)}</p>`;
  return `<div class="pay-box">
    <p style="color:var(--mute);margin:0">Order ${esc(o.code)}</p>
    <div class="amount">${amt}</div>
    <p style="font-weight:800;margin-top:6px">${esc(pm.label)}</p>
    ${body}
    ${pm.instructions ? `<p style="white-space:pre-line;background:var(--paper);border-radius:12px;padding:12px;text-align:left">${esc(pm.instructions)}</p>` : ""}
    <form id="paid-form" style="max-width:420px;margin:18px auto 0;display:grid;gap:8px">
      <label style="font-weight:700;font-size:13px;text-align:left">Payment reference or the name it came from <small style="font-weight:500;color:var(--mute)">optional, helps us match it faster</small><input class="input" name="ref" maxlength="120"></label>
      <button class="btn btn-ink">I've paid</button>
    </form>
  </div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500);
});
