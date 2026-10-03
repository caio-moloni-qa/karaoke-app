export interface ParsedCsvRow {
  [column: string]: string;
}

// Minimal CSV parser for the song-import format: comma-delimited,
// double-quote-escaped fields (""  for a literal quote), CRLF/LF line
// endings, blank lines and lines starting with "#" ignored. Not a general
// CSV implementation — no custom delimiters, no newlines embedded inside a
// quoted field spanning multiple physical lines.
export function parseCsv(text: string): ParsedCsvRow[] {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: ParsedCsvRow = {};
    header.forEach((col, i) => {
      row[col] = values[i] ?? "";
    });
    return row;
  });
}

// Inverse of parseCsv for the same artist/title shape — used by the
// "Baixar .csv" export of a staged (possibly Spotify-sourced/edited) import
// list, so the user ends up with an actual file in the documented format.
export function toCsv(rows: { artist: string; title: string }[]): string {
  const escape = (field: string) => (/[",\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field);
  return ["artist,title", ...rows.map((r) => `${escape(r.artist)},${escape(r.title)}`)].join("\n");
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}
