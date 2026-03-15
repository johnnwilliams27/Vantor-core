export interface ExportColumn<T> {
  header: string;
  accessor: (row: T) => string;
  pdfWidth?: string;
}

export { exportCsv } from './csv';
export { exportPdf } from './pdf';
