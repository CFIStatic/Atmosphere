/**
 * The two products share one session. The bottom bar is the switch —
 * Field Capture (the phone) and the office platform (everything happening).
 */
export const FIELD_CAPTURE_HOME = '/my-work';
export const PLATFORM_SWITCH_HOME = '/field';

export function isFieldCapturePath(pathname: string): boolean {
  return (
    pathname === '/my-work' ||
    pathname === '/technician' ||
    pathname.startsWith('/technician/') ||
    pathname === '/fieldcapture' ||
    pathname.startsWith('/fieldcapture/')
  );
}
