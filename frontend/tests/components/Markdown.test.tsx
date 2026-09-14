import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../../src/components/Markdown';

/**
 * Regression coverage for the "AI Assistant must never show raw Markdown
 * syntax" requirement: every one of these asserts the literal `**`/`#`/`` `
 * ``/`|`/`---`/`- [ ]` characters are NOT in the rendered text, and that
 * the intended element type (strong/em/code/heading/list/table/checkbox/hr)
 * is used instead.
 *
 * Phase 17's "RAG Response Structuring Fix" replaced the previous
 * hand-rolled parser (headings/lists/bold/italic/inline-code only -- no
 * tables, fenced code blocks, checklists, links, or horizontal rules) with
 * `react-markdown` + `remark-gfm` + `remark-breaks`. That gap -- not the
 * backend/RAG pipeline, which already returns ordinary Markdown text -- is
 * what made real answers (like the payment-service recovery runbook's own
 * table/checklist-heavy formatting) show up as literal `|`/`---`/`` ``` ``
 * text. These tests are the actual regression coverage for that bug.
 */
describe('Markdown', () => {
  it('renders **bold** as <strong>, not literal asterisks', () => {
    render(<Markdown text="**Status:** degraded" />);
    expect(screen.getByText('Status:').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('renders *italic* as <em>', () => {
    render(<Markdown text="This is *important* context." />);
    expect(screen.getByText('important').tagName).toBe('EM');
  });

  it('renders `code` as <code>', () => {
    render(<Markdown text="Call `get_service` to check." />);
    expect(screen.getByText('get_service').tagName).toBe('CODE');
  });

  it('renders a heading line as a heading element, not a literal "#"', () => {
    render(<Markdown text={'## Payment Service health\nEverything below is detail.'} />);
    expect(screen.getByRole('heading', { name: 'Payment Service health' })).toBeInTheDocument();
  });

  it('renders a level-4 (####) heading too, not just levels 1-3', () => {
    render(<Markdown text={'#### 1. Confirm current state'} />);
    expect(screen.getByRole('heading', { name: '1. Confirm current state' })).toBeInTheDocument();
    expect(screen.queryByText(/####/)).not.toBeInTheDocument();
  });

  it('renders "- item" lines as a real bullet list', () => {
    render(<Markdown text={'Findings:\n- P50 is elevated\n- Error rate is elevated'} />);
    const list = screen.getByText('P50 is elevated').closest('ul');
    expect(list).not.toBeNull();
    expect(screen.getByText('Error rate is elevated').tagName).toBe('LI');
  });

  it('renders "1. item" lines as a real numbered list', () => {
    render(<Markdown text={'1. Confirm the alert is real\n2. Classify the failure'} />);
    const list = screen.getByText('Confirm the alert is real').closest('ol');
    expect(list).not.toBeNull();
    expect(screen.getByText('Classify the failure').tagName).toBe('LI');
  });

  it('renders a Markdown table as a real <table>, not raw pipe characters', () => {
    const { container } = render(
      <Markdown
        text={['| Action | Why |', '| --- | --- |', '| Check service health | Confirm degraded/down state |', '| Review recent metrics | Detect sustained issue |'].join(
          '\n'
        )}
      />
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Why' })).toBeInTheDocument();
    expect(screen.getByText('Check service health').closest('td')).not.toBeNull();
    expect(screen.getByText('Confirm degraded/down state')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\|/);
  });

  it('renders a fenced code block as a <pre><code> block, not literal backticks', () => {
    const { container } = render(<Markdown text={['Check the live state first:', '', '```bash', 'curl -s /api/services/payment-service', '```'].join('\n')} />);
    const code = screen.getByText('curl -s /api/services/payment-service');
    expect(code.tagName).toBe('CODE');
    expect(code.closest('pre')).not.toBeNull();
    expect(container.textContent).not.toContain('```');
  });

  it('renders "- [ ] item" / "- [x] item" as real, disabled checkboxes, not literal brackets', () => {
    render(<Markdown text={['- [ ] Re-check service health', '- [x] Verify latency and error rate'].join('\n')} />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    checkboxes.forEach((box) => expect(box).toBeDisabled());
    expect(screen.getByText('Re-check service health')).toBeInTheDocument();
    expect(screen.queryByText(/\[ \]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[x\]/i)).not.toBeInTheDocument();
  });

  it('renders "---" as a real <hr>, not literal dashes', () => {
    const { container } = render(<Markdown text={['A concise summary.', '', '---', '', 'More detail below.'].join('\n')} />);
    expect(container.querySelector('hr')).not.toBeNull();
    expect(screen.queryByText('---')).not.toBeInTheDocument();
  });

  it('renders multi-line plain text with real line breaks, not run together', () => {
    const { container } = render(<Markdown text={'P50 latency 180 ms\nP99 latency 640 ms'} />);
    expect(screen.getByText(/P50 latency 180 ms/)).toBeInTheDocument();
    expect(screen.getByText(/P99 latency 640 ms/)).toBeInTheDocument();
    expect(container.querySelector('br')).not.toBeNull();
  });

  it('leaves plain text with no markdown untouched', () => {
    render(<Markdown text="Payment Service is currently healthy." />);
    expect(screen.getByText('Payment Service is currently healthy.')).toBeInTheDocument();
  });

  it('never executes a raw <script> or javascript: link embedded in model output', () => {
    const { container } = render(
      <Markdown text={['<script>window.__pwned = true</script>', '', '[click me](javascript:alert(1))'].join('\n')} />
    );
    expect(container.querySelector('script')).toBeNull();
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('renders a realistic RAG recovery-runbook answer as fully structured content, with no raw Markdown syntax anywhere', () => {
    const answer = [
      '## Payment Service Recovery',
      '',
      '**Summarized from the Payment Service Recovery Runbook.**',
      '',
      '---',
      '',
      '#### 1. Confirm current state',
      '',
      'Before taking action, verify that the alert is still active.',
      '',
      '| Action | Why |',
      '| --- | --- |',
      '| Check service health | Confirm degraded/down state |',
      '| Review recent metrics | Detect sustained issue |',
      '',
      '#### 2. Mitigate',
      '',
      'If it is a bad deployment, run `rollback --service payment-service`.',
      '',
      '```bash',
      'curl -s /api/services/payment-service',
      '```',
      '',
      '#### 3. Confirm recovery',
      '',
      '- [ ] Re-check service health',
      '- [x] Verify latency and error rate',
    ].join('\n');

    const { container } = render(<Markdown text={answer} />);

    // Structure: heading, bold, table, inline code, fenced code, checklist.
    expect(screen.getByRole('heading', { name: 'Payment Service Recovery' })).toBeInTheDocument();
    expect(screen.getByText('Summarized from the Payment Service Recovery Runbook.').tagName).toBe('STRONG');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('rollback --service payment-service').tagName).toBe('CODE');
    expect(screen.getByText('curl -s /api/services/payment-service').closest('pre')).not.toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(container.querySelector('hr')).not.toBeNull();

    // No raw Markdown syntax anywhere in the rendered text.
    const text = container.textContent ?? '';
    expect(text).not.toContain('**');
    expect(text).not.toContain('####');
    expect(text).not.toContain('```');
    expect(text).not.toMatch(/\|/);
    expect(text).not.toContain('- [ ]');
    expect(text).not.toContain('- [x]');
    expect(text).not.toContain('---\n');
  });
});
