import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const saveWorkbook = vi.hoisted(() => vi.fn());
vi.mock('../lib/excelWriter', () => ({ saveWorkbook }));

import { DownloadButton } from './DownloadButton';
import { isoDay, type ExportSheet } from '../lib/excel';

describe('DownloadButton', () => {
  it('builds the sheets on click (async fetch included) and saves a dated .xlsx', async () => {
    const user = userEvent.setup();
    const sheet: ExportSheet = { name: 'Rows', columns: [{ header: 'n', type: 'integer' }], rows: [[1], [2], [3]] };
    const sheets = vi.fn(async () => [sheet]);
    render(<DownloadButton table="user-actions" label="user actions" sheets={sheets} />);
    expect(sheets).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Download user actions as Excel' }));
    await waitFor(() => expect(saveWorkbook).toHaveBeenCalledTimes(1));
    expect(sheets).toHaveBeenCalledTimes(1);
    expect(saveWorkbook).toHaveBeenCalledWith(`atmosphere-user-actions-${isoDay()}.xlsx`, [sheet]);
  });

  it('shows an error instead of failing silently', async () => {
    const user = userEvent.setup();
    render(
      <DownloadButton
        table="t"
        label="things"
        sheets={() => Promise.reject(new Error('Request failed (500)'))}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Download things as Excel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (500)');
  });
});
