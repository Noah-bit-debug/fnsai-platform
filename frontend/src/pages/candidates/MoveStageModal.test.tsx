/**
 * Component-level regression tests for the Move Stage modal.
 *
 * Pins the cumulative QA fixes:
 *   - PR #15: error from onMove must surface inline. Modal must NOT
 *     close on error. saving state must clear so the user can retry.
 *     Double-click protection via useRef.
 *   - PR #18: stage list must be fetched from the backend
 *     /pipeline-stages endpoint, not hardcoded — the previous
 *     hardcoded list 100% failed for "Credentialing" / "Onboarding"
 *     / "Placed" because the dynamic backend pipeline uses different
 *     keys. Picking the current stage is disabled.
 *
 * Each test mocks pipelineStagesApi at the module level so the modal
 * doesn't make real HTTP calls.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/ToastHost';

// Mock the api module before importing the component so the inline
// `pipelineStagesApi.list()` call inside MoveStageModal hits the mock.
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    pipelineStagesApi: {
      list: vi.fn(),
    },
  };
});

import { MoveStageModal } from './CandidateDetail';
import { pipelineStagesApi } from '../../lib/api';

const STAGES = [
  { id: '1', tenant_id: 'default', key: 'screening',     label: 'Screening',     sort_order: 1, is_terminal: false, active: true },
  { id: '2', tenant_id: 'default', key: 'interview',     label: 'Interview',     sort_order: 2, is_terminal: false, active: true },
  { id: '3', tenant_id: 'default', key: 'offer',         label: 'Offer',         sort_order: 3, is_terminal: false, active: true },
  { id: '4', tenant_id: 'default', key: 'placed',        label: 'Placed',        sort_order: 4, is_terminal: false, active: true },
  { id: '5', tenant_id: 'default', key: 'rejected',      label: 'Rejected',      sort_order: 5, is_terminal: true,  active: true },
];

function renderModal(overrides: Partial<{
  currentStage: string;
  onClose: () => void;
  onMove: (stage: string, notes: string) => Promise<void>;
}> = {}) {
  const props = {
    currentStage: 'screening',
    onClose: vi.fn(),
    onMove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return {
    ...render(
      <ToastProvider>
        <MoveStageModal {...props} />
      </ToastProvider>,
    ),
    props,
  };
}

beforeEach(() => {
  vi.mocked(pipelineStagesApi.list).mockResolvedValue({
    data: { stages: STAGES },
  } as any);
});

describe('<MoveStageModal />', () => {
  test('fetches stages from /pipeline-stages on mount (PR #18)', async () => {
    renderModal();
    await waitFor(() => {
      expect(pipelineStagesApi.list).toHaveBeenCalledTimes(1);
    });
  });

  test('renders the dynamic stage list (PR #18 — not the hardcoded legacy 7)', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /interview/i })).toBeInTheDocument();
    });
    // The QA-reported "Unknown stage 'credentialing'" 400 came from the
    // OLD hardcoded list including stages the backend never accepts.
    // The dynamic list excludes those — verify Credentialing is not
    // in the rendered options.
    expect(screen.queryByRole('option', { name: /^credentialing$/i })).not.toBeInTheDocument();
  });

  test('current stage option is marked disabled (cannot move to current)', async () => {
    renderModal({ currentStage: 'screening' });
    await waitFor(() => {
      const screening = screen.getByRole('option', { name: /screening/i }) as HTMLOptionElement;
      expect(screening).toBeDisabled();
    });
  });

  test('closes only on successful onMove (PR #15)', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({
      onMove: vi.fn().mockResolvedValue(undefined),
    });
    await waitFor(() => screen.getByRole('option', { name: /interview/i }));

    await user.selectOptions(screen.getByRole('combobox'), 'interview');
    await user.click(screen.getByRole('button', { name: /move stage/i }));

    await waitFor(() => {
      expect(props.onMove).toHaveBeenCalledWith('interview', '');
    });
    // onClose isn't called by the modal itself on success — the parent's
    // onMove handler is responsible (it calls setShowMoveStage(false)).
    // The modal stays mounted until the parent unmounts it.
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test('stays open and surfaces error message inline when onMove rejects (PR #15)', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({
      onMove: vi.fn().mockRejectedValue({
        response: { data: { error: 'no_job_link', message: "Can't move to placed without a job." } },
      }),
    });
    await waitFor(() => screen.getByRole('option', { name: /placed/i }));

    await user.selectOptions(screen.getByRole('combobox'), 'placed');
    await user.click(screen.getByRole('button', { name: /move stage/i }));

    // Error surfaces inline (the message OR the error code)
    await waitFor(() => {
      expect(screen.getByText(/no_job_link/i)).toBeInTheDocument();
    });
    // Modal does NOT auto-close on error — user has to retry or cancel
    expect(props.onClose).not.toHaveBeenCalled();
    // Saving state is cleared so the button is re-enabled
    expect(screen.getByRole('button', { name: /move stage/i })).not.toBeDisabled();
  });

  test('disables Move button on the same stage as current (no-op guard)', async () => {
    renderModal({ currentStage: 'interview' });
    await waitFor(() => screen.getByRole('option', { name: /interview/i }));
    // Default stage value matches currentStage → disabled.
    expect(screen.getByRole('button', { name: /move stage/i })).toBeDisabled();
  });

  test('Cancel button calls onClose without invoking onMove', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    await waitFor(() => screen.getByRole('option', { name: /interview/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onMove).not.toHaveBeenCalled();
  });

  test('shows loading state while stages are being fetched', () => {
    // Make the list call hang so the loading state is observable
    vi.mocked(pipelineStagesApi.list).mockReturnValue(new Promise(() => {}) as any);
    renderModal();
    expect(screen.getByText(/loading stages/i)).toBeInTheDocument();
  });

  test('shows error state if /pipeline-stages fetch fails', async () => {
    vi.mocked(pipelineStagesApi.list).mockRejectedValue({
      response: { data: { error: 'auth required' } },
    });
    renderModal();
    await waitFor(() => {
      expect(screen.getByText(/auth required/i)).toBeInTheDocument();
    });
  });
});
