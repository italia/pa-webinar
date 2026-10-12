import { onTestFinished, vi } from 'vitest';

/**
 * jsdom non apre i <dialog>: showModal e close come nel browser, compreso
 * l'evento `close`, per il tempo di un test. Si chiama dentro il test.
 */
export function finestraNativa() {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  const prima = { showModal: proto.showModal, close: proto.close };
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  proto.showModal = showModal;
  proto.close = close;
  onTestFinished(() => {
    proto.showModal = prima.showModal;
    proto.close = prima.close;
  });
  return { showModal, close };
}
