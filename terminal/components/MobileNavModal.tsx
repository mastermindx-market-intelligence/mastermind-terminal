"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import styles from "./MobileNav.module.css";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Release = (restoreFocus?: boolean) => void;

export default function MobileNavModal({
  id,
  label,
  closeLabel,
  openerRef,
  onClose,
  children,
}: {
  id: string;
  label: string;
  closeLabel: string;
  openerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const releaseRef = useRef<Release | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const pathname = usePathname();
  const openedPathnameRef = useRef(pathname);

  const dismiss = useCallback(() => {
    releaseRef.current?.(true);
    onClose();
  }, [onClose]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const html = document.documentElement;
    const body = document.body;
    const opener = openerRef.current;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const htmlOverflow = html.style.overflow;
    const bodyOverflow = body.style.overflow;
    const htmlScrollBehavior = html.style.scrollBehavior;
    const bodyScrollBehavior = body.style.scrollBehavior;
    let released = false;

    const release: Release = (restoreFocus = false) => {
      if (released) return;
      released = true;

      if (dialog.open) dialog.close();

      html.style.overflow = htmlOverflow;
      body.style.overflow = bodyOverflow;

      const samePathname = window.location.pathname === openedPathnameRef.current;
      if (samePathname) {
        window.scrollTo(scrollX, scrollY);
      }

      html.style.scrollBehavior = htmlScrollBehavior;
      body.style.scrollBehavior = bodyScrollBehavior;

      if (restoreFocus && samePathname && opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };

    releaseRef.current = release;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";

    if (!dialog.open) dialog.showModal();

    const firstNavLink = dialog.querySelector<HTMLElement>(".m-nav a[href]");
    firstNavLink?.focus({ preventScroll: true });
    window.scrollTo(scrollX, scrollY);

    const mobileViewport = window.matchMedia("(max-width: 860px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) dismiss();
    };
    mobileViewport.addEventListener("change", handleViewportChange);

    return () => {
      mobileViewport.removeEventListener("change", handleViewportChange);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      release(false);
      if (releaseRef.current === release) releaseRef.current = null;
    };
  }, [dismiss, openerRef]);

  useLayoutEffect(() => {
    if (pathname === openedPathnameRef.current) return;
    releaseRef.current?.(false);
    onClose();
  }, [onClose, pathname]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;

    const drawer = dialogRef.current?.querySelector<HTMLElement>(".m-drawer");
    if (!drawer) return;

    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => (
      element.getClientRects().length > 0
      && element.getAttribute("aria-hidden") !== "true"
      && getComputedStyle(element).visibility !== "hidden"
    ));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !drawer.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  const handleActionCapture = (event: MouseEvent<HTMLDialogElement>) => {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest(
      ".m-nav a[href], .m-nav button, .m-drawer-ft button",
    );
    if (!action || !event.currentTarget.contains(action)) return;

    releaseRef.current?.(true);
    // React can commit a capture-phase state update before the child's bubble
    // handler. Release modality now, but keep that handler mounted through this
    // click (SettingsButton stops propagation). Route/AI handlers close directly
    // and their unmount cleanup cancels this redundant timer.
    if (closeTimerRef.current === null) {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 0);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      id={id}
      aria-label={label}
      aria-modal="true"
      className={styles.modal}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={handleKeyDown}
      onClickCapture={handleActionCapture}
    >
      <div
        className={`m-drawer-scrim open ${styles.scrim}`}
        aria-hidden="true"
        onClick={dismiss}
      />
      <div className={`m-drawer open ${styles.drawer}`}>
        <button
          type="button"
          className={styles.close}
          aria-label={closeLabel}
          onClick={dismiss}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
