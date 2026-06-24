import { Alert, Platform } from 'react-native';

type ExportSection = {
  title: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
};

function safeCell(value: string | number | null | undefined) {
  return value === null || value === undefined ? '' : String(value);
}

function escapeHtml(value: string | number | null | undefined) {
  return safeCell(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function downloadText(filename: string, content: string, type: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    Alert.alert('Export', 'Export inapatikana kwenye web preview kwa sasa.');
    return;
  }

  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${safeCell(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, csv, 'text/csv;charset=utf-8');
}

export function downloadExcel(filename: string, sections: ExportSection[]) {
  const tables = sections
    .map(
      (section) => `
        <h2>${escapeHtml(section.title)}</h2>
        <table>
          <thead>
            <tr>${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${section.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
              .join('')}
          </tbody>
        </table>
      `
    )
    .join('<br />');

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          h2 { margin: 18px 0 8px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
          th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
          th { background: #E7F6F0; font-weight: 700; }
        </style>
      </head>
      <body>${tables}</body>
    </html>
  `;

  downloadText(filename, html, 'application/vnd.ms-excel;charset=utf-8');
}

export function printPdf(title: string, sections: ExportSection[]) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    Alert.alert('PDF', 'PDF inapatikana kwenye web preview kwa sasa.');
    return;
  }

  const tables = sections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.title)}</h2>
          <table>
            <thead>
              <tr>${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${section.rows
                .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
                .join('')}
            </tbody>
          </table>
        </section>
      `
    )
    .join('');

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { margin: 18mm; }
          body { color: #10221C; font-family: Arial, sans-serif; margin: 0; }
          h1 { color: #075C48; font-size: 24px; margin: 0 0 6px; }
          h2 { border-bottom: 2px solid #0B8F6A; font-size: 16px; margin: 24px 0 10px; padding-bottom: 6px; }
          p { color: #66756F; margin: 0 0 18px; }
          table { border-collapse: collapse; font-size: 11px; width: 100%; }
          th, td { border: 1px solid #DDE8E3; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #E7F6F0; color: #075C48; font-weight: 700; }
          tr:nth-child(even) td { background: #F7FAF8; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p>Generated ${escapeHtml(new Date().toLocaleString())}</p>
        ${tables}
      </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    downloadText(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`, html, 'text/html;charset=utf-8');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
}

export type { ExportSection };
