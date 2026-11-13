/**
 * Modal dialog component controller
 */

const dialog = document.querySelector("#form-dialog");

export function openModal(title, subtitle, body, footer) {
  if (!dialog) return;
  dialog.innerHTML = `
    <div class="modal-header">
      <div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      <button class="modal-close" type="button" data-close aria-label="Close">×</button>
    </div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer">${footer}</div>
  `;
  if (!dialog.open) {
    dialog.showModal();
  }
}

export function closeModal() {
  if (dialog && dialog.open) {
    dialog.close();
  }
}

export function getDialog() {
  return dialog;
}
