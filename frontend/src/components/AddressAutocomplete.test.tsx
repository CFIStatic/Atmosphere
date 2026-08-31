import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressAutocomplete } from './AddressAutocomplete';

const placesAutocomplete = vi.fn();
const placesStatus = vi.fn();
const placesDetails = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    placesStatus: (...args: unknown[]) => placesStatus(...args),
    placesAutocomplete: (...args: unknown[]) => placesAutocomplete(...args),
    placesDetails: (...args: unknown[]) => placesDetails(...args),
  },
}));

describe('AddressAutocomplete', () => {
  beforeEach(() => {
    placesStatus.mockResolvedValue({ configured: true });
    placesAutocomplete.mockResolvedValue({
      configured: true,
      suggestions: [
        {
          placeId: 'p1',
          description: 'East Racine Avenue, Waukesha, Wisconsin, 53186',
          mainText: 'East Racine Avenue',
          secondaryText: 'Waukesha, Wisconsin, 53186',
        },
      ],
    });
    placesDetails.mockResolvedValue({
      address: {
        formatted: 'East Racine Avenue, Waukesha, Wisconsin, 53186, US',
        addressLine1: 'East Racine Avenue',
        city: 'Waukesha',
        postalCode: '53186',
      },
    });
  });

  it('does not ask to pick a recommended place when the address is already filled', async () => {
    render(
      <AddressAutocomplete
        value="East Racine Avenue, Waukesha, Wisconsin, 53186, US"
        onChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(placesStatus).toHaveBeenCalled();
    });
    expect(placesAutocomplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('looks up suggestions only after the user types', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('');
      return <AddressAutocomplete value={value} onChange={setValue} />;
    }
    render(<Harness />);

    expect(await screen.findByText(/Search Google for the site/i)).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'East Rac');

    await waitFor(() => {
      expect(placesAutocomplete).toHaveBeenCalled();
    });
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('East Racine Avenue')).toBeInTheDocument();
  });

  it('confirms a picked Google suggestion', async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    function Harness() {
      const [value, setValue] = useState('');
      return <AddressAutocomplete value={value} onChange={setValue} onResolved={onResolved} />;
    }
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'East Rac');
    await user.click(await screen.findByRole('button', { name: /East Racine Avenue/i }));
    await waitFor(() => {
      expect(placesDetails).toHaveBeenCalled();
    });
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        addressLine1: 'East Racine Avenue',
        city: 'Waukesha',
        postalCode: '53186',
      }),
    );
  });
});
