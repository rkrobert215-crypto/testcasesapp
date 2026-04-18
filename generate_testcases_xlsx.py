#!/usr/bin/env python3
"""
Generate test cases from a requirement and save them to XLSX.

Default flow:
1. Reads a requirement from --requirement, --input-file, or stdin.
2. Picks the best generation style automatically unless overridden.
3. Calls the local AI generate route.
4. Saves the result to an .xlsx file.

Requirements:
- The local AI server should be running:
  npm run server:generate
  or START_FULL_LOCAL.bat
- Your provider key can come from:
  - the interactive prompt
  - --api-key
  - supabase/functions/.env.local
  - environment variables
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import textwrap
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parent
LOCAL_FUNCTIONS_ENV = ROOT / "supabase" / "functions" / ".env.local"
DEFAULT_ENDPOINT = os.environ.get(
    "LOCAL_AI_SERVER_URL",
    "http://127.0.0.1:8787/functions/v1/generate-test-cases",
)

STYLE_LABELS = {
    "rob_style": "Rob",
    "yuv_style": "Yuv",
    "professional_standard": "Professional Standard",
    "swag_style": "SWAG",
}

OPENAI_MODELS = {"gpt-5.4", "gpt-5.4-mini"}
CLAUDE_MODELS = {"claude-sonnet-4-20250514", "claude-opus-4-1-20250805"}
GEMINI_MODELS = {"gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"}

COLUMNS = [
    ("id", "TC ID"),
    ("requirementReference", "Requirement Ref"),
    ("module", "Module"),
    ("priority", "Priority"),
    ("coverageArea", "Coverage Area"),
    ("scenario", "Scenario"),
    ("testCase", "Test Case"),
    ("testData", "Test Data"),
    ("preconditions", "Preconditions"),
    ("testSteps", "Test Steps"),
    ("expectedResult", "Expected Result"),
    ("postCondition", "Post Condition"),
    ("type", "Type"),
]


def xml_doc(content: str) -> str:
    return textwrap.dedent(content).lstrip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate test cases from a requirement and save them to XLSX.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument("--requirement", help="Requirement text passed directly on the command line.")
    parser.add_argument("--input-file", help="Path to a text/markdown file containing the requirement.")
    parser.add_argument("--output", help="Output .xlsx file path. Defaults to a smart generated filename.")
    parser.add_argument(
        "--style",
        default="auto",
        choices=["auto", "rob", "yuv", "professional", "swag"],
        help="Generation style to use. Default: auto",
    )
    parser.add_argument(
        "--provider",
        choices=["openai", "claude", "gemini", "groq", "openrouter"],
        help="Provider override. If omitted, the local backend default is used.",
    )
    parser.add_argument("--api-key", help="Provider API key override. If omitted, the script can prompt for it.")
    parser.add_argument("--openai-model", choices=["gpt-5.4", "gpt-5.4-mini"])
    parser.add_argument("--claude-model", choices=["claude-sonnet-4-20250514", "claude-opus-4-1-20250805"])
    parser.add_argument("--gemini-model", choices=["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"])
    parser.add_argument("--openrouter-model", help="OpenRouter model slug, e.g. openrouter/free")
    parser.add_argument(
        "--input-type",
        default="requirement",
        choices=["requirement", "highlevel", "testcase", "scenario", "expected"],
        help="Generator input type. Default: requirement",
    )
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help=f"Local generate endpoint. Default: {DEFAULT_ENDPOINT}")
    parser.add_argument(
        "--retries",
        type=int,
        default=0,
        help="Number of retries for transient API/server failures. Default: 0",
    )
    parser.add_argument(
        "--retry-delay",
        type=int,
        default=10,
        help="Seconds to wait between retries. Default: 10",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip the API call and write a sample XLSX file to validate the export path.",
    )
    parser.add_argument(
        "--strict-exact",
        action="store_true",
        help="Enable strict exact-requirement mode to keep output closer to exact labels, config keys, and acceptance criteria wording.",
    )
    return parser.parse_args()


def read_requirement(args: argparse.Namespace) -> str:
    if args.requirement:
        return args.requirement.strip()

    if args.input_file:
        return Path(args.input_file).read_text(encoding="utf-8").strip()

    if sys.stdin.isatty():
        print("Paste the requirement below. Type END on a new line when finished.", file=sys.stderr)
        lines: list[str] = []
        while True:
            try:
                line = input()
            except EOFError:
                break
            if line.strip() == "END":
                break
            lines.append(line)
        return "\n".join(lines).strip()

    return sys.stdin.read().strip()


def pick_best_style(requirement: str, input_type: str) -> str:
    if input_type != "requirement":
        return "professional_standard"

    lower = requirement.lower()

    swag_signals = [
        "accessibility",
        "keyboard",
        "focus",
        "aria",
        "mobile",
        "responsive",
        "tablet",
        "browser",
        "chrome",
        "firefox",
        "safari",
        "edge",
        "notification",
        "email",
        "export",
        "download",
        "import",
        "api",
        "network",
        "payload",
        "response",
        "rollback",
        "performance",
        "loading",
        "spinner",
        "concurrent",
        "multi-user",
        "stale",
        "double submit",
        "double click",
        "onboarding",
        "account setting",
        "setup",
    ]
    yuv_signals = [
        "list",
        "grid",
        "table",
        "filter",
        "sort",
        "search",
        "column",
        "row",
        "page",
        "details",
        "pill",
        "tab",
        "status",
    ]
    rob_signals = [
        "permission",
        "authority",
        "role",
        "unauthorized",
        "allowed",
        "access",
        "can_",
        "preview permission",
        "manage permission",
    ]

    swag_score = sum(1 for signal in swag_signals if signal in lower)
    yuv_score = sum(1 for signal in yuv_signals if signal in lower)
    rob_score = sum(1 for signal in rob_signals if signal in lower)

    if swag_score >= 2 and swag_score >= max(yuv_score, rob_score):
        return "swag_style"
    if yuv_score >= 2 and yuv_score >= rob_score:
        return "yuv_style"
    if rob_score >= 2:
        return "rob_style"
    return "professional_standard"


def resolve_generation_mode(style_arg: str, requirement: str, input_type: str) -> str:
    if style_arg == "auto":
        return pick_best_style(requirement, input_type)
    if style_arg == "rob":
        return "rob_style"
    if style_arg == "yuv":
        return "yuv_style"
    if style_arg == "professional":
        return "professional_standard"
    if style_arg == "swag":
        return "swag_style"
    raise ValueError(f"Unsupported style: {style_arg}")


def resolve_provider(args: argparse.Namespace) -> str:
    return args.provider or os.environ.get("AI_PROVIDER", "gemini")


def get_default_models(args: argparse.Namespace) -> dict[str, str]:
    return {
        "openaiModel": args.openai_model or os.environ.get("OPENAI_MODEL", "gpt-5.4"),
        "claudeModel": args.claude_model or os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
        "geminiModel": args.gemini_model or os.environ.get("GEMINI_MODEL", "gemini-2.5-pro"),
        "openrouterModel": args.openrouter_model or os.environ.get("OPENROUTER_MODEL", "openrouter/free"),
    }


def normalize_model_choice(provider: str, raw_value: str, current_models: dict[str, str]) -> str:
    value = raw_value.strip()
    if not value:
        if provider == "openai":
            return current_models["openaiModel"]
        if provider == "claude":
            return current_models["claudeModel"]
        if provider == "gemini":
            return current_models["geminiModel"]
        if provider == "openrouter":
            return current_models["openrouterModel"]
        return ""

    if provider == "openai":
        if value not in OPENAI_MODELS:
            raise RuntimeError(f"Unsupported OpenAI model: {value}")
        return value
    if provider == "claude":
        if value not in CLAUDE_MODELS:
            raise RuntimeError(f"Unsupported Claude model: {value}")
        return value
    if provider == "gemini":
        if value not in GEMINI_MODELS:
            raise RuntimeError(f"Unsupported Gemini model: {value}")
        return value
    if provider == "openrouter":
        return value
    return ""


def prompt_provider_model_and_api_key(
    args: argparse.Namespace,
    provider: str,
    existing_api_key: str | None,
    current_models: dict[str, str],
) -> tuple[str, str, dict[str, str]]:
    selected_provider = provider
    updated_models = dict(current_models)

    if args.api_key:
        return selected_provider, args.api_key, updated_models

    if sys.stdin.isatty():
        try:
            provider_input = input(f"Provider [{provider}]: ").strip().lower()
            if provider_input:
                if provider_input not in {"openai", "claude", "gemini", "groq", "openrouter"}:
                    raise RuntimeError(f"Unsupported provider: {provider_input}")
                selected_provider = provider_input

            existing_api_key = get_existing_api_key(selected_provider, args)
            if selected_provider == "gemini":
                print(
                    "Gemini models: gemini-2.5-pro, gemini-2.5-flash, gemini-3-flash-preview",
                    file=sys.stderr,
                )
                model_input = input(
                    f"Gemini model [{updated_models['geminiModel']}]: "
                )
                updated_models["geminiModel"] = normalize_model_choice(selected_provider, model_input, updated_models)
            elif selected_provider == "openai":
                print("OpenAI models: gpt-5.4, gpt-5.4-mini", file=sys.stderr)
                model_input = input(
                    f"OpenAI model [{updated_models['openaiModel']}]: "
                )
                updated_models["openaiModel"] = normalize_model_choice(selected_provider, model_input, updated_models)
            elif selected_provider == "claude":
                print(
                    "Claude models: claude-sonnet-4-20250514, claude-opus-4-1-20250805",
                    file=sys.stderr,
                )
                model_input = input(
                    f"Claude model [{updated_models['claudeModel']}]: "
                )
                updated_models["claudeModel"] = normalize_model_choice(selected_provider, model_input, updated_models)
            elif selected_provider == "openrouter":
                print("OpenRouter model example: openrouter/free", file=sys.stderr)
                model_input = input(
                    f"OpenRouter model [{updated_models['openrouterModel']}]: "
                )
                updated_models["openrouterModel"] = normalize_model_choice(selected_provider, model_input, updated_models)
            else:
                updated_models = current_models

            prompt = f"Paste {selected_provider} API key"
            if existing_api_key:
                prompt += " (press Enter to use existing env/arg value)"
            prompt += ": "
            pasted_key = input(prompt).strip()
            if pasted_key:
                return selected_provider, pasted_key, updated_models
        except EOFError:
            pass

    if existing_api_key:
        return selected_provider, existing_api_key, updated_models

    raise RuntimeError(
        "No API key available. Pass --api-key, paste it when prompted, or set it in supabase/functions/.env.local or environment variables."
    )


def build_ai_settings(
    args: argparse.Namespace,
    generation_mode: str,
    provider: str,
    api_key: str,
    model_settings: dict[str, str],
) -> dict[str, object]:
    settings = {
        "provider": provider,
        "generationMode": generation_mode,
        "strictRequirementMode": bool(args.strict_exact),
        "openaiApiKey": "",
        "claudeApiKey": "",
        "geminiApiKey": "",
        "groqApiKey": "",
        "openrouterApiKey": "",
        "openaiModel": model_settings["openaiModel"],
        "claudeModel": model_settings["claudeModel"],
        "geminiModel": model_settings["geminiModel"],
        "openrouterModel": model_settings["openrouterModel"],
    }

    if provider == "openai":
        settings["openaiApiKey"] = api_key
    elif provider == "claude":
        settings["claudeApiKey"] = api_key
    elif provider == "gemini":
        settings["geminiApiKey"] = api_key
    elif provider == "groq":
        settings["groqApiKey"] = api_key
    elif provider == "openrouter":
        settings["openrouterApiKey"] = api_key

    return settings


def get_local_env_value(name: str) -> str:
    if not LOCAL_FUNCTIONS_ENV.exists():
        return ""

    pattern = re.compile(rf"^\s*{re.escape(name)}\s*=\s*(.+?)\s*$")
    for line in LOCAL_FUNCTIONS_ENV.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = pattern.match(line)
        if match:
            return match.group(1).strip().strip("\"'")
    return ""


def get_existing_api_key(provider: str, args: argparse.Namespace) -> str:
    if args.api_key:
        return args.api_key
    if provider == "openai":
        return os.environ.get("OPENAI_API_KEY", "") or get_local_env_value("OPENAI_API_KEY")
    if provider == "claude":
        return (
            os.environ.get("ANTHROPIC_API_KEY", "")
            or os.environ.get("CLAUDE_API_KEY", "")
            or get_local_env_value("ANTHROPIC_API_KEY")
            or get_local_env_value("CLAUDE_API_KEY")
        )
    if provider == "gemini":
        return (
            os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", "")
            or get_local_env_value("GEMINI_API_KEY")
            or get_local_env_value("GOOGLE_API_KEY")
        )
    if provider == "groq":
        return os.environ.get("GROQ_API_KEY", "") or get_local_env_value("GROQ_API_KEY")
    if provider == "openrouter":
        return os.environ.get("OPENROUTER_API_KEY", "") or get_local_env_value("OPENROUTER_API_KEY")
    return ""


def should_retry(message: str) -> bool:
    lower = message.lower()
    transient_signals = [
        "high demand",
        "please try again later",
        "please retry in",
        "fetch failed",
        "timed out",
        "timeout",
        "temporarily unavailable",
        "rate limit",
        "429",
    ]
    return any(signal in lower for signal in transient_signals)


def call_generate_endpoint(
    endpoint: str,
    requirement: str,
    input_type: str,
    ai_settings: dict[str, object],
    retries: int,
    retry_delay: int,
) -> list[dict[str, str]]:
    payload = {
        "input": requirement,
        "inputType": input_type,
        "imagesBase64": [],
        "aiSettings": ai_settings,
    }
    attempts = retries + 1

    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
                message = parsed.get("error") or raw
            except json.JSONDecodeError:
                message = raw

            if attempt < attempts and should_retry(message):
                print(
                    f"Attempt {attempt} failed: {message.strip()} Retrying in {retry_delay}s...",
                    file=sys.stderr,
                )
                time.sleep(retry_delay)
                continue
            raise RuntimeError(f"Generation failed with HTTP {exc.code}: {message}") from exc
        except urllib.error.URLError as exc:
            message = "Could not reach the local generate server. Start it with START_FULL_LOCAL.bat or `npm run server:generate`."
            if attempt < attempts:
                print(
                    f"Attempt {attempt} failed: {message} Retrying in {retry_delay}s...",
                    file=sys.stderr,
                )
                time.sleep(retry_delay)
                continue
            raise RuntimeError(message) from exc

        parsed = json.loads(raw)
        test_cases = parsed.get("testCases")
        if not isinstance(test_cases, list):
            raise RuntimeError(f"Unexpected response from local server: {parsed}")
        return [normalize_row(item) for item in test_cases if isinstance(item, dict)]

    raise RuntimeError("Generation failed after all retry attempts.")


def normalize_row(item: dict) -> dict[str, str]:
    return {key: stringify(item.get(key, "")) for key, _ in COLUMNS}


def stringify(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def create_sample_rows() -> list[dict[str, str]]:
    return [
        {
            "id": "TC_001",
            "requirementReference": "AC-01",
            "module": "Sample Module",
            "priority": "High",
            "coverageArea": "Smoke",
            "scenario": "Sample dry-run export",
            "testCase": "Verify that the sample row is written to the workbook",
            "testData": "N/A",
            "preconditions": "Script executed in dry-run mode",
            "testSteps": "Run the Python export script with --dry-run",
            "expectedResult": "Workbook generated with the sample testcase row",
            "postCondition": "Sample file available in the output location",
            "type": "Positive",
        }
    ]


def build_default_output_name(requirement: str) -> str:
    words = re.sub(r"[^A-Za-z0-9\s]", " ", requirement).split()
    filtered = [
        word.capitalize()
        for word in words
        if len(word) > 2 and word.lower() not in {"the", "and", "for", "that", "with", "this", "from", "user", "want", "able"}
    ]
    stem = "".join(filtered[:4]) or "GeneratedTestCases"
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    return f"{stem} - {timestamp}.xlsx"


def save_xlsx(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    col_widths = []
    for key, label in COLUMNS:
        max_len = len(label)
        for row in rows:
            max_len = max(max_len, min(60, len(row.get(key, ""))))
        col_widths.append(min(max_len + 2, 60))

    sheet_rows = [dict(COLUMNS)] + rows

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml())
        zf.writestr("_rels/.rels", root_rels_xml())
        zf.writestr("docProps/app.xml", app_xml())
        zf.writestr("docProps/core.xml", core_xml())
        zf.writestr("xl/workbook.xml", workbook_xml())
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml())
        zf.writestr("xl/styles.xml", styles_xml())
        zf.writestr("xl/worksheets/sheet1.xml", worksheet_xml(sheet_rows, col_widths))


def content_types_xml() -> str:
    return xml_doc(
        """\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
          <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
          <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
          <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
          <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
        </Types>
        """
    )


def root_rels_xml() -> str:
    return xml_doc(
        """\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
          <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
        </Relationships>
        """
    )


def app_xml() -> str:
    return xml_doc(
        """\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
                    xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
          <Application>Python</Application>
        </Properties>
        """
    )


def core_xml() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return xml_doc(
        f"""\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                           xmlns:dc="http://purl.org/dc/elements/1.1/"
                           xmlns:dcterms="http://purl.org/dc/terms/"
                           xmlns:dcmitype="http://purl.org/dc/dcmitype/"
                           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <dc:creator>Codex</dc:creator>
          <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
          <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
          <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
        </cp:coreProperties>
        """
    )


def workbook_xml() -> str:
    return xml_doc(
        """\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets>
            <sheet name="Test Cases" sheetId="1" r:id="rId1"/>
          </sheets>
        </workbook>
        """
    )


def workbook_rels_xml() -> str:
    return xml_doc(
        """\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
        </Relationships>
        """
    )


def styles_xml() -> str:
    return xml_doc(
        """\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="2">
            <font>
              <sz val="11"/>
              <name val="Calibri"/>
            </font>
            <font>
              <b/>
              <sz val="11"/>
              <name val="Calibri"/>
            </font>
          </fonts>
          <fills count="3">
            <fill><patternFill patternType="none"/></fill>
            <fill><patternFill patternType="gray125"/></fill>
            <fill>
              <patternFill patternType="solid">
                <fgColor rgb="FFDCE6F1"/>
                <bgColor indexed="64"/>
              </patternFill>
            </fill>
          </fills>
          <borders count="2">
            <border>
              <left/><right/><top/><bottom/><diagonal/>
            </border>
            <border>
              <left style="thin"><color auto="1"/></left>
              <right style="thin"><color auto="1"/></right>
              <top style="thin"><color auto="1"/></top>
              <bottom style="thin"><color auto="1"/></bottom>
              <diagonal/>
            </border>
          </borders>
          <cellStyleXfs count="1">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
          </cellStyleXfs>
          <cellXfs count="3">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
            <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
              <alignment wrapText="1" vertical="top" horizontal="center"/>
            </xf>
            <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
              <alignment wrapText="1" vertical="top"/>
            </xf>
          </cellXfs>
          <cellStyles count="1">
            <cellStyle name="Normal" xfId="0" builtinId="0"/>
          </cellStyles>
        </styleSheet>
        """
    )


def worksheet_xml(rows: list[dict[str, str]], col_widths: list[int]) -> str:
    cols_xml = "".join(
        f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>'
        for idx, width in enumerate(col_widths, start=1)
    )
    last_column = column_name(len(COLUMNS))
    last_row = len(rows)

    row_xml_parts = []
    for row_index, row in enumerate(rows, start=1):
        style_index = 1 if row_index == 1 else 2
        cells = []
        for col_index, (key, _label) in enumerate(COLUMNS, start=1):
            ref = f"{column_name(col_index)}{row_index}"
            value = row.get(key, "")
            cells.append(inline_string_cell(ref, value, style_index))
        row_xml_parts.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    return xml_doc(
        f"""\
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <dimension ref="A1:{last_column}{last_row}"/>
          <sheetViews>
            <sheetView workbookViewId="0">
              <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
              <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
            </sheetView>
          </sheetViews>
          <sheetFormatPr defaultRowHeight="18"/>
          <cols>{cols_xml}</cols>
          <sheetData>
            {''.join(row_xml_parts)}
          </sheetData>
          <autoFilter ref="A1:{last_column}{last_row}"/>
        </worksheet>
        """
    )


def inline_string_cell(reference: str, value: str, style_index: int) -> str:
    safe_value = escape(value)
    return f'<c r="{reference}" t="inlineStr" s="{style_index}"><is><t xml:space="preserve">{safe_value}</t></is></c>'


def column_name(index: int) -> str:
    result = []
    while index:
        index, remainder = divmod(index - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))


def print_summary(
    rows: list[dict[str, str]],
    output_path: Path,
    generation_mode: str,
    endpoint: str,
    dry_run: bool,
    strict_exact: bool,
) -> None:
    print(f"Style used: {STYLE_LABELS.get(generation_mode, generation_mode)}")
    print(f"Strict exact mode: {'On' if strict_exact else 'Off'}")
    print(f"Rows written: {len(rows)}")
    print(f"Output file: {output_path}")
    if not dry_run:
        print(f"Endpoint used: {endpoint}")


def main() -> int:
    args = parse_args()
    requirement = read_requirement(args)

    if not requirement and not args.dry_run:
        print("No requirement provided.", file=sys.stderr)
        return 1

    generation_mode = resolve_generation_mode(args.style, requirement, args.input_type)
    output_path = Path(args.output) if args.output else ROOT / build_default_output_name(requirement or "Generated Test Cases")

    if args.dry_run:
        rows = create_sample_rows()
    else:
        initial_provider = resolve_provider(args)
        initial_api_key = get_existing_api_key(initial_provider, args)
        default_models = get_default_models(args)
        provider, api_key, model_settings = prompt_provider_model_and_api_key(args, initial_provider, initial_api_key, default_models)
        ai_settings = build_ai_settings(args, generation_mode, provider, api_key, model_settings)
        rows = call_generate_endpoint(
            args.endpoint,
            requirement,
            args.input_type,
            ai_settings,
            args.retries,
            args.retry_delay,
        )
        if not rows:
            print("No test cases were returned.", file=sys.stderr)
            return 1

    save_xlsx(rows, output_path)
    print_summary(rows, output_path, generation_mode, args.endpoint, args.dry_run, args.strict_exact)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        raise SystemExit(130)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
