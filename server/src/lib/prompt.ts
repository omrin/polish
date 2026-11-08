// Port of desktop/wa_core/prompt.py. shared/prompt.json is the single source of truth.
import PROMPT from "../../../shared/prompt.json";

export { PROMPT };
export type Mode = "fix" | "rephrase";

export function buildSystemPrompt(mode: Mode, labels: string[], explanationLanguage = "auto"): string {
  const langs = PROMPT.explanation_language as Record<string, string>;
  const lang = langs[explanationLanguage] ?? langs.auto;
  const instruction = (PROMPT.rephrasing_instruction as Record<string, string>)[mode]
    .split("{n}").join(String(labels.length))
    .split("{labels}").join(labels.join(", "));
  return PROMPT.system_prompt.split("{explanation_language}").join(lang).split("{rephrasing_instruction}").join(instruction);
}

export const buildUserMessage = (text: string) => PROMPT.user_template.split("{text}").join(text);
