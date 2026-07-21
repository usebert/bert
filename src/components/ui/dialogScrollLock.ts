/**
 * Shared scroll-lock for viewport-safe dialogs (portal-based).
 * Mirrors Add Document dialog behaviour without changing that component.
 */
export function lockDialogScroll(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const previousBody = {
    overflow: document.body.style.overflow,
    position: document.body.style.position,
    top: document.body.style.top,
    width: document.body.style.width,
  };
  const windowScrollY = window.scrollY;
  const stage = document.querySelector(".qms-screen-stage") as HTMLElement | null;
  const previousStageOverflow = stage?.style.overflow || "";
  const stageScrollTop = stage?.scrollTop || 0;

  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${windowScrollY}px`;
  document.body.style.width = "100%";
  if (stage) {
    stage.style.overflow = "hidden";
  }

  return () => {
    document.body.style.overflow = previousBody.overflow;
    document.body.style.position = previousBody.position;
    document.body.style.top = previousBody.top;
    document.body.style.width = previousBody.width;
    window.scrollTo(0, windowScrollY);
    if (stage) {
      stage.style.overflow = previousStageOverflow;
      stage.scrollTop = stageScrollTop;
    }
  };
}
