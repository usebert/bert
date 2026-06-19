const DEFAULT_COMPLIANCE_OPTIONS = ["Compliant", "Non-compliant", "Not applicable"];

const BULLET_PREFIX = /^[-*•]\s+|^\d+[.)]\s+/;

function defaultQuestion(questionText) {
  return {
    question_text: String(questionText || "").trim(),
    answer_type: "compliance",
    options: [...DEFAULT_COMPLIANCE_OPTIONS],
    requires_comment_on_failure: true,
    requires_action_on_failure: true,
    allows_photo_evidence: true,
  };
}

function cleanLine(raw) {
  return String(raw || "")
    .trim()
    .replace(BULLET_PREFIX, "")
    .trim();
}

function isQuestionLine(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  return BULLET_PREFIX.test(trimmed);
}

function isLikelySectionHeading(raw, nextRaw) {
  const line = cleanLine(raw);
  if (!line || line.endsWith("?")) return false;
  if (isQuestionLine(raw)) return false;
  if (nextRaw && isQuestionLine(nextRaw)) return true;
  return line.length <= 80;
}

/**
 * Deterministic checklist parser — no external AI.
 * @param {string} text
 */
export function parseChecklistText(text) {
  const rawLines = String(text || "").split(/\r?\n/);
  const lines = rawLines.map((line) => line.trim()).filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error("Paste checklist text before generating a template.");
  }

  let templateName = "Untitled Audit Template";
  let startIndex = 0;

  if (!lines[0].endsWith("?")) {
    templateName = cleanLine(lines[0]) || templateName;
    startIndex = 1;
  }

  const sections = [];
  let currentSection = { name: "General", questions: [] };

  for (let index = startIndex; index < lines.length; index += 1) {
    const raw = lines[index];
    const nextRaw = index + 1 < lines.length ? lines[index + 1] : null;

    if (isLikelySectionHeading(raw, nextRaw)) {
      if (currentSection.questions.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { name: cleanLine(raw) || "General", questions: [] };
      continue;
    }

    if (isQuestionLine(raw)) {
      const questionText = cleanLine(raw);
      if (questionText) {
        currentSection.questions.push(defaultQuestion(questionText));
      }
      continue;
    }

    const fallbackText = cleanLine(raw);
    if (fallbackText) {
      currentSection.questions.push(defaultQuestion(fallbackText));
    }
  }

  if (currentSection.questions.length > 0) {
    sections.push(currentSection);
  }

  const normalizedSections = sections.filter((section) => section.questions.length > 0);
  const questionCount = normalizedSections.reduce((sum, section) => sum + section.questions.length, 0);

  if (questionCount === 0) {
    throw new Error("No questions found in checklist text.");
  }

  return {
    template_name: templateName,
    description: "",
    category: "Audits",
    sections: normalizedSections,
  };
}

export const FIRE_SAFETY_SEED_TEXT = `Fire Safety Check Audit

Audit details
- Auditor name recorded?
- Date and site/area recorded?
- Previous actions reviewed?

Fire alarm and detection
- Alarm panel shows normal status?
- Call points unobstructed?
- Detectors free from obstruction?

Fire extinguishers
- Correct type and location?
- Within service date?
- Pin and seal intact?

Fire exits and escape routes
- Exits unlocked and clear?
- Routes free from obstruction?
- Final exit opens freely?

Emergency lighting and signage
- Escape route signage visible?
- Emergency lights operational?

Fire doors
- Self-closing correctly?
- Intumescent strips intact?
- Kept closed when not in use?

Housekeeping and fire risks
- Combustible waste removed?
- Flammable liquids stored correctly?
- Electrical sockets not overloaded?

Training drills and documentation
- Fire drill within required period?
- Training records up to date?

Actions required
- Open actions from previous audit closed or escalated?

Sign-off
- Responsible person sign-off completed?`;
