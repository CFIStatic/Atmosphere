import { render, screen } from '@testing-library/react';
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
    expect(screen.getAllByText('/ month')).toHaveLength(3);
    for (const amount of ['$399', '$849', '$1,999']) {
      const price = screen.getByText(amount);
      expect(price.className).toMatch(/whitespace-nowrap/);
      expect(price.parentElement?.className).not.toMatch(/flex-col/);
      expect(price.nextElementSibling?.textContent).toBe('/ month');
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
});
