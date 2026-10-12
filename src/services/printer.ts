import {
  getPrinters,
  printHtml,
  type PrintHtmlOptions,
} from 'tauri-plugin-printer-v2';
import { getPrinterSettings } from './PrinterSetting';

export interface SystemPrinter {
  name: string;
  isDefault?: boolean;
}

export async function fetchSystemPrinters(): Promise<SystemPrinter[]> {
  try {
    const printers = await getPrinters();
    console.log('Available printers:', printers.map(p => p.name));
    return printers as SystemPrinter[];
  } catch (error) {
    console.error('Failed to query system printers:', error);
    return [];
  }
}

/**
 * Dispatches an HTML payload silently, using the printer configuration
 * saved on the Settings page (printer name, page size, orientation,
 * color mode, copies, margins). Falls back to sane defaults only if
 * no settings have been saved yet.
 */
export async function executeSilentHtmlPrint(htmlContent: string): Promise<void> {
  const printers = await fetchSystemPrinters();

  if (printers.length === 0) {
    throw new Error("No operational printers discovered on this system.");
  }

  const savedSettings = await getPrinterSettings();

  // Prefer the printer saved in Settings; fall back to the OS default,
  // then to whatever's first in the list.
  const preferredName = savedSettings?.printerName;
  const targetPrinter =
    printers.find(p => p.name === preferredName) ||
    printers.find(p => p.isDefault) ||
    printers[0];

  const options: PrintHtmlOptions = {
    html: htmlContent,
    printerId: targetPrinter.name,
    pageSize: savedSettings?.pageSize ?? 'A4',
    orientation: savedSettings?.orientation ?? 'Portrait',
    copies: savedSettings?.copies ?? 1,
    grayscale: savedSettings ? savedSettings.colorMode === 'BlackAndWhite' : true,
    removeAfterPrint: true,
    margin: {
      top: savedSettings?.marginTopCm ?? 1,
      bottom: savedSettings?.marginBottomCm ?? 1,
      left: savedSettings?.marginLeftCm ?? 1,
      right: savedSettings?.marginRightCm ?? 1,
      unit: 'cm',
    },
  };

  try {
    await printHtml(options);
    console.log(`Print job successfully dispatched to: ${targetPrinter.name}`);
  } catch (printError) {
    console.error("The system print engine rejected the raw job context:", printError);
    throw printError; // re-throw so callers (e.g. auto-print on save) know it failed
  }
}