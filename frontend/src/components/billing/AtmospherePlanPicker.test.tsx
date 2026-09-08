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
