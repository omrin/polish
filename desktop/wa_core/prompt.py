from . import shared_data

MODES = ("fix", "rephrase")


def build_system_prompt(mode: str, labels: list[str], explanation_language: str = "auto") -> str:
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode!r}")
    data = shared_data.load()
    lang = data["explanation_language"].get(explanation_language, data["explanation_language"]["auto"])
    instruction = data["rephrasing_instruction"][mode]
    instruction = instruction.replace("{n}", str(len(labels))).replace("{labels}", ", ".join(labels))
    return (
        data["system_prompt"]
        .replace("{explanation_language}", lang)
        .replace("{rephrasing_instruction}", instruction)
    )


def build_user_message(text: str) -> str:
    return shared_data.load()["user_template"].replace("{text}", text)
