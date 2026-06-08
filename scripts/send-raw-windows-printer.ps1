param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,

  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA
  {
    public string pDocName;
    public string pOutputFile;
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter(string szPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, DOCINFOA pDocInfo);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendFile(string printerName, string filePath)
  {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
    {
      throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    }

    try
    {
      DOCINFOA docInfo = new DOCINFOA();
      docInfo.pDocName = "SmartRush Ticket";
      docInfo.pDataType = "RAW";

      if (StartDocPrinter(hPrinter, 1, docInfo) == 0)
      {
        throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      }

      try
      {
        if (!StartPagePrinter(hPrinter))
        {
          throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
        }

        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr unmanagedBytes = Marshal.AllocHGlobal(bytes.Length);
        try
        {
          Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written))
          {
            throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
          }
          if (written != bytes.Length)
          {
            throw new Exception("WritePrinter wrote " + written + " of " + bytes.Length + " bytes");
          }
        }
        finally
        {
          Marshal.FreeHGlobal(unmanagedBytes);
        }

        EndPagePrinter(hPrinter);
      }
      finally
      {
        EndDocPrinter(hPrinter);
      }
    }
    finally
    {
      ClosePrinter(hPrinter);
    }
  }
}
"@

[RawPrinterHelper]::SendFile($PrinterName, $FilePath)
