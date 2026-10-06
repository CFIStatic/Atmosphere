import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fixture from '../../dev/hdOrderV2Fixture.json';
import { ComputerApprovalCard } from './ComputerApprovalCard';
import type { ComputerTaskApproval } from '../../lib/computer';

const approval: ComputerTaskApproval = {
  id: 'a1',
  status: 'pending',
  actionKind: 'pay',
  buttonLabel: 'Place Order',
  summary: fixture.approve.summary,
  pageUrl: fixture.approve.pageUrl,
  fields: fixture.approve.fields,
  screenshot: null,
  requestedAt: '2026-10-05T23:40:00Z',
  expiresAt: '2026-10-06T00:40:00Z',
};

describe('ComputerApprovalCard (supply order)', () => {
  it('renders one compact row per line, no raw URLs, one payment line, one "nothing is purchased"', () => {
    render(<ComputerApprovalCard approval={approval} onApprove={() => {}} onTakeControl={() => {}} onCancel={() => {}} />);
    const card = screen.getByTestId('computer-approval-card');
    expect(within(card).getByTestId('computer-approval-title')).toHaveTextContent('Place this Home Depot order?');
    expect(within(card).getAllByTestId('order-line')).toHaveLength(fixture.cart.lines.length);
    expect(within(card).queryAllByTestId('computer-approval-field')).toHaveLength(0);
    const linesBox = within(card).getByTestId('order-lines');
    expect(linesBox.textContent).not.toMatch(/https?:\/\//);
    expect(within(card).getByTestId('order-not-added')).toHaveTextContent('upper cabinet');
    const text = card.textContent ?? '';
    expect(text.match(/Nothing is purchased until you press Approve/g)).toHaveLength(1);
    expect(text.match(/Atmosphere never sees card numbers/g)).toHaveLength(1);
  });
});

describe('ComputerApprovalCard (per-line checkboxes)', () => {
  it('starts with only ready lines checked and labels Approve with the live count and total', async () => {
    const { fireEvent } = await import('@testing-library/react');
    let sent: unknown = null;
    render(
      <ComputerApprovalCard approval={approval} onApprove={(s) => (sent = s)} onTakeControl={() => {}} onCancel={() => {}} />,
    );
    const rows = screen.getAllByTestId('order-line');
    const byMaterial = (m: string) => rows.find((r) => r.textContent?.includes(`For ${m}`))!;
    // Ready → checked; Needs your choice / Qty unknown → unchecked.
    expect(within(byMaterial('laminate countertop')).getByTestId('order-line-check')).toBeChecked();
    expect(within(byMaterial('base cabinet')).getByTestId('order-line-check')).not.toBeChecked();
    expect(within(byMaterial('birch plywood')).getByTestId('order-line-check')).toBeDisabled();
    const approve = screen.getByTestId('computer-approval-approve');
    const summary = screen.getByTestId('order-live-summary');
    expect(approve).toHaveTextContent('Approve 1 item, $73.44');
    expect(summary).toHaveTextContent('1 of 7 items checked, $73.44. 5 still need a quantity and 3 need your choice.');

    // Confirm the low-confidence cabinet: total updates live.
    fireEvent.click(within(byMaterial('base cabinet')).getByTestId('order-line-check'));
    expect(approve).toHaveTextContent('Approve 2 items, $292.44');
    expect(summary).toHaveTextContent('2 of 7 items checked, $292.44. 5 still need a quantity and 2 need your choice.');
    expect(screen.getByTestId('order-total-amount')).toHaveTextContent('$292.44');

    // Typing a quantity fixes an unknown-qty line and checks it.
    fireEvent.change(within(byMaterial('birch plywood')).getByTestId('order-line-qty-input'), { target: { value: '2' } });
    expect(within(byMaterial('birch plywood')).getByTestId('order-line-check')).toBeChecked();
    expect(approve).toHaveTextContent('Approve 3 items, $395.60');
    expect(summary).toHaveTextContent('3 of 7 items checked, $395.60. 4 still need a quantity and 2 need your choice.');

    // Unchecking removes it from the total.
    fireEvent.click(within(byMaterial('laminate countertop')).getByTestId('order-line-check'));
    expect(approve).toHaveTextContent('Approve 2 items, $322.16');
    expect(summary).toHaveTextContent('2 of 7 items checked, $322.16. 4 still need a quantity and 2 need your choice.');
    expect(within(byMaterial('laminate countertop')).getByTestId('order-line-total')).toHaveTextContent('Not in order');

    fireEvent.click(approve);
    expect(sent).toEqual({ lines: [{ key: 'L2:100545475' }, { key: 'L3:305213039', quantity: 2 }] });
  });

  it('disables Approve when nothing is checked', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<ComputerApprovalCard approval={approval} onApprove={() => {}} onTakeControl={() => {}} onCancel={() => {}} />);
    const lam = screen.getAllByTestId('order-line').find((r) => r.textContent?.includes('For laminate countertop'))!;
    fireEvent.click(within(lam).getByTestId('order-line-check'));
    expect(screen.getByTestId('computer-approval-approve')).toBeDisabled();
    expect(screen.getByTestId('computer-approval-approve')).toHaveTextContent('Check an item to approve');
  });
});

describe('ComputerApprovalCard (live summary)', () => {
  it('reads "All N items checked" once every line is fixed and checked', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<ComputerApprovalCard approval={approval} onApprove={() => {}} onTakeControl={() => {}} onCancel={() => {}} />);
    const rows = screen.getAllByTestId('order-line');
    for (const r of rows) {
      const input = within(r).queryByTestId('order-line-qty-input');
      if (input) fireEvent.change(input, { target: { value: '1' } });
      const box = within(r).getByTestId('order-line-check') as HTMLInputElement;
      if (!box.checked) fireEvent.click(box);
    }
    const total = screen.getByTestId('order-total-amount').textContent!;
    expect(screen.getByTestId('order-live-summary')).toHaveTextContent(`All 7 items checked, ${total}.`);
    expect(screen.getByTestId('order-live-summary').textContent).not.toMatch(/need/);
    expect(screen.getByTestId('computer-approval-approve')).toHaveTextContent(`Approve 7 items, ${total}`);
  });
});
