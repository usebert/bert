/**
 * Pure viewport layout checks for the Add Document dialog.
 */

export function rectFromValues(top, left, width, height) {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function overlapsViewport(rect, viewportHeight, viewportWidth) {
  return (
    rect.top < viewportHeight &&
    rect.bottom > 0 &&
    rect.left < viewportWidth &&
    rect.right > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function evaluateAddDocumentDialogViewportLayout(snapshot) {
  const failures = [];
  const { viewportWidth, viewportHeight, dialog, header, footer, firstField } = snapshot;

  if (!(dialog.top >= -0.5)) {
    failures.push(`dialog.top (${dialog.top}) is above the viewport`);
  }
  if (!(dialog.bottom <= viewportHeight + 0.5)) {
    failures.push(`dialog.bottom (${dialog.bottom}) exceeds viewport height (${viewportHeight})`);
  }
  if (!(dialog.left >= -0.5)) {
    failures.push(`dialog.left (${dialog.left}) is left of the viewport`);
  }
  if (!(dialog.right <= viewportWidth + 0.5)) {
    failures.push(`dialog.right (${dialog.right}) exceeds viewport width (${viewportWidth})`);
  }
  if (!overlapsViewport(header, viewportHeight, viewportWidth)) {
    failures.push("header is not visible in the viewport");
  }
  if (!overlapsViewport(footer, viewportHeight, viewportWidth)) {
    failures.push("footer is not visible in the viewport");
  }
  if (!overlapsViewport(firstField, viewportHeight, viewportWidth)) {
    failures.push("first field is not visible in the viewport");
  }
  if (!(firstField.top >= dialog.top - 0.5 && firstField.bottom <= dialog.bottom + 0.5)) {
    failures.push("first field is outside the dialog bounds");
  }
  if (!(header.top >= dialog.top - 0.5)) {
    failures.push("header is above the dialog top");
  }
  if (!(footer.bottom <= dialog.bottom + 0.5)) {
    failures.push("footer is below the dialog bottom");
  }

  return { ok: failures.length === 0, failures };
}
