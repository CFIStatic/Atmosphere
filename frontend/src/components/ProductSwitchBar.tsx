import { Link, useLocation } from 'react-router-dom';
import { DecisionIcon, VideoIcon } from './icons';
import {
  FIELD_CAPTURE_HOME,
  PLATFORM_SWITCH_HOME,
  isFieldCapturePath,
} from '../lib/productSwitch';

/**
 * Two tabs. Field Capture is the phone — jobs you are on, film the day.
 * Platform is the office — proof chain, library, job files.
 *
 * Always on screen. The rail stays for office destinations; this bar is
 * how you cross from the truck to the desk.
 */
export function ProductSwitchBar({ besideRail = false }: { besideRail?: boolean }) {
  const { pathname } = useLocation();
  const field = isFieldCapturePath(pathname);

  return (
    <nav
      aria-label="Product"
      data-testid="product-switch"
      className={`fixed bottom-0 right-0 z-40 border-t border-line bg-paper-0/95 backdrop-blur-xl ${
        besideRail ? 'left-[248px]' : 'left-0'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-2">
        <SwitchTab
          to={FIELD_CAPTURE_HOME}
          label="Field Capture"
          hint="Your jobs"
          Icon={VideoIcon}
          current={field}
        />
        <SwitchTab
          to={PLATFORM_SWITCH_HOME}
          label="Platform"
          hint="The office"
          Icon={DecisionIcon}
          current={!field}
        />
      </div>
    </nav>
  );
}

function SwitchTab({
  to,
  label,
  hint,
  Icon,
  current,
}: {
  to: string;
  label: string;
  hint: string;
  Icon: typeof VideoIcon;
  current: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={`flex flex-col items-center gap-0.5 px-3 py-2.5 text-center transition ${
        current ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-paper-200/70 hover:text-ink-800'
      }`}
    >
      <Icon width={20} height={20} />
      <span className="text-[13px] font-semibold leading-tight">{label}</span>
      <span className={`text-[10.5px] leading-tight ${current ? 'text-brand-600' : 'text-ink-400'}`}>
        {hint}
      </span>
    </Link>
  );
}

/** Space so page content is not hidden behind the product bar. */
export const PRODUCT_SWITCH_PAD = 'calc(4.75rem + env(safe-area-inset-bottom, 0px))';
