import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_SELF_SERVE_PLANS } from '../../lib/atmospherePlans';
import { AtmospherePlanPicker } from './AtmospherePlanPicker';

function Picker({
  initial = 'work_verification' as const,
}: {
  initial?: (typeof ATMOSPHERE_SELF_SERVE_PLANS)[number]['code'];
}) {
  const [value, setValue] = useState(initial);
  return (
    <AtmospherePlanPicker
      plans={ATMOSPHERE_SELF_SERVE_PLANS}
      value={value}
      onChange={setValue}
    />
  );
}

describe('AtmospherePlanPicker', () => {
  it('renders an equal trio with title-case names and aligned price copy', () => {
    render(<Picker />);

    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Work Verification')).toBeInTheDocument();
    expect(screen.getByText('Scale')).toBeInTheDocument();
    expect(screen.getByText('$399')).toBeInTheDocument();
    expect(screen.getByText('$849')).toBeInTheDocument();
    expect(screen.getByText('$1,999')).toBeInTheDocument();
    expect(screen.getAllByText('Per Month')).toHaveLength(3);
    for (const amount of ['$399', '$849', '$1,999']) {
      const price = screen.getByText(amount);
      expect(price.className).toMatch(/whitespace-nowrap/);
      expect(price.parentElement?.className).not.toMatch(/flex-col/);
      expect(price.nextElementSibling?.textContent).toBe('Per Month');
      expect(price.nextElementSibling?.className).toMatch(/text-sm/);
      expect(price.nextElementSibling?.className).toMatch(/text-ink-500/);
      expect(price.nextElementSibling?.className).toMatch(/whitespace-nowrap/);
    }
    const note = screen.getByText(/Extra Field Capture seats are \$125\/mo each/);
    expect(note.className).toMatch(/text-xs/);
    expect(note.className).toMatch(/text-ink-500/);
    expect(note.textContent).toMatch(/Seats count Field Capture accounts only/);
    expect(note.textContent).toMatch(/office-only Global Admins do not use a seat/);
    expect(note.textContent).toMatch(/AI\/token usage is billed the day it is used/);
    expect(note.textContent).toMatch(/Prices increase 10% annually on your plan anniversary \(30-day notice\)/);
    expect(screen.getAllByText(/\$125\/mo/)).toHaveLength(1);
    expect(screen.getAllByText(/office-only Global Admins/)).toHaveLength(1);
    expect(screen.getAllByText(/30-day notice/)).toHaveLength(1);
    expect(screen.getByText('1 Field Capture account')).toBeInTheDocument();
    expect(screen.getByText('3 Field Capture accounts')).toBeInTheDocument();
    expect(screen.getByText('10 Field Capture accounts')).toBeInTheDocument();
    expect(screen.queryByText(/included/i)).toBeNull();
    const badges = screen.getAllByText('Recommended');
    expect(badges).toHaveLength(3);
    expect(badges.filter((el) => el.className.includes('invisible'))).toHaveLength(2);
    expect(badges.filter((el) => !el.className.includes('invisible'))).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Work Verification/i })).toBeChecked();
  });

  it('keeps plan names title-case on a single line', () => {
    render(<Picker />);
    const name = screen.getByText('Work Verification');
    expect(name.className).not.toMatch(/uppercase/);
    expect(name.className).toMatch(/whitespace-nowrap/);
    expect(name.textContent).toBe('Work Verification');
  });

  it('keeps a constant selected border so choosing a plan does not shift layout classes', async () => {
    const user = userEvent.setup();
    render(<Picker />);

    const starter = screen.getByRole('radio', { name: /Starter/i });
    const work = screen.getByRole('radio', { name: /Work Verification/i });
    const starterCard = starter.closest('label');
    const workCard = work.closest('label');

    expect(starterCard?.className).toMatch(/border-2/);
    expect(workCard?.className).toMatch(/border-2/);
    expect(workCard?.className).toMatch(/border-brand-500/);

    await user.click(starter);
    expect(starter).toBeChecked();
    expect(starter.closest('label')?.className).toMatch(/border-2/);
    expect(starter.closest('label')?.className).toMatch(/border-brand-500/);
    expect(work.closest('label')?.className).toMatch(/border-2/);
    expect(work.closest('label')?.className).not.toMatch(/border-brand-500/);
  });

  it('hides the yearly toggle until annual prices are configured', () => {
    render(<Picker />);
    expect(screen.queryByRole('radio', { name: /Monthly/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Yearly/i })).toBeNull();
    expect(screen.getAllByText('Per Month')).toHaveLength(3);
  });

  it('shows yearly prices, the free-months badge, and the annual seat note', async () => {
    const user = userEvent.setup();
    function Yearly() {
      const [value, setValue] = useState<'starter' | 'work_verification' | 'scale'>('work_verification');
      const [interval, setInterval] = useState<'month' | 'year'>('month');
      return (
        <AtmospherePlanPicker
          plans={ATMOSPHERE_SELF_SERVE_PLANS}
          value={value}
          onChange={setValue}
          interval={interval}
          onIntervalChange={setInterval}
          annualAvailable
        />
      );
    }
    render(<Yearly />);

    const intervals = screen.getByRole('radiogroup', { name: 'Billing interval' });
    const monthly = within(intervals).getByRole('radio', { name: /^Monthly/i });
    const yearly = within(intervals).getByRole('radio', { name: /Yearly/i });
    expect(monthly).toBeChecked();
    expect(monthly.closest('label')?.className).toMatch(/bg-brand-500/);
    expect(yearly.closest('label')?.className).not.toMatch(/bg-brand-500/);
    const badge = screen.getByText('2 months free');
    expect(badge.className).toMatch(/bg-brand-100/);
    expect(badge.className).toMatch(/text-brand-800/);
    expect(badge.className).not.toMatch(/text-white/);
    expect(screen.getAllByText('Per Month')).toHaveLength(3);
    expect(screen.getByText(/\$125\/mo/)).toBeInTheDocument();

    await user.click(yearly);
    expect(yearly).toBeChecked();
    expect(yearly.closest('label')?.className).toMatch(/bg-brand-500/);
    expect(monthly.closest('label')?.className).not.toMatch(/bg-brand-500/);
    expect(badge.className).toMatch(/bg-brand-100/);
    expect(badge.className).toMatch(/text-brand-800/);
    expect(screen.getByText('$3,990')).toBeInTheDocument();
    expect(screen.getByText('$8,490')).toBeInTheDocument();
    expect(screen.getByText('$19,990')).toBeInTheDocument();
    expect(screen.getAllByText('Per Year')).toHaveLength(3);
    expect(screen.getByText('$332.50/mo billed yearly')).toBeInTheDocument();
    expect(screen.getByText('$707.50/mo billed yearly')).toBeInTheDocument();
    expect(screen.getByText('$1,665.83/mo billed yearly')).toBeInTheDocument();
    for (const amount of ['$3,990', '$8,490', '$19,990']) {
      const price = screen.getByText(amount);
      expect(price.className).toMatch(/whitespace-nowrap/);
      expect(price.nextElementSibling?.textContent).toBe('Per Year');
      expect(price.nextElementSibling?.className).toMatch(/text-sm/);
      expect(price.nextElementSibling?.className).toMatch(/text-ink-500/);
    }
    const note = screen.getByText(/Extra Field Capture seats are \$1,250\/yr each/);
    expect(note.textContent).toMatch(/AI\/token usage is billed the day it is used/);
    expect(note.textContent).toMatch(/locked for the term/);
    expect(note.textContent).toMatch(/non-refundable/);
    expect(note.textContent).toMatch(/cancel at the end of the term/);
    expect(screen.queryByText(/\$125\/mo/)).toBeNull();
  });
});
