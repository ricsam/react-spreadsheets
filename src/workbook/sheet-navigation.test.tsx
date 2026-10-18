import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { SheetNavigation } from './sheet-navigation';

afterEach(cleanup);
function setup(overrides = {}) {
  const rename = mock(() => {});
  const remove = mock(() => {});
  function Harness() {
    const [active, setActive] = useState('Model');
    return (
      <SheetNavigation
        sheets={['Model', 'Inputs']}
        activeSheet={active}
        workbookName="Book"
        onSelect={setActive}
        onAdd={() => {}}
        onRename={rename}
        onDelete={remove}
        {...overrides}
      />
    );
  }
  return { ...render(<Harness />), rename, remove };
}
describe('sheet navigation', () => {
  test('roving tab focus supports arrows, Home and End', () => {
    const view = setup();
    const model = view.getByRole('tab', { name: 'Model' });
    const inputs = view.getByRole('tab', { name: 'Inputs' });
    model.focus();
    fireEvent.keyDown(model, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(inputs);
    expect(inputs.getAttribute('aria-selected')).toBe('true');
    expect(model.tabIndex).toBe(-1);
    fireEvent.keyDown(inputs, { key: 'Home' });
    expect(document.activeElement).toBe(model);
    fireEvent.keyDown(model, { key: 'End' });
    expect(document.activeElement).toBe(inputs);
  });
  test('rename preserves invalid input and Escape cancels without a blur commit', () => {
    const view = setup();
    fireEvent.keyDown(view.getByRole('tab', { name: 'Model' }), { key: 'F2' });
    const input = view.getByLabelText('Sheet name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: ' inputs ' } });
    fireEvent.click(view.getByText('Save'));
    expect(view.getByRole('alert').textContent).toContain('already exists');
    expect(input.value).toBe(' inputs ');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(view.getByText('Save'));
    expect(view.getByRole('alert').textContent).toBe('Enter a sheet name.');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(view.queryByLabelText('Sheet name')).toBeNull();
    expect(view.rename).not.toHaveBeenCalled();
  });
  test('rename trims and commits exactly once only on Save', () => {
    const view = setup();
    fireEvent.doubleClick(view.getByRole('tab', { name: 'Model' }));
    const input = view.getByLabelText('Sheet name');
    fireEvent.change(input, { target: { value: ' Forecast ' } });
    fireEvent.blur(input);
    expect(view.rename).not.toHaveBeenCalled();
    fireEvent.click(view.getByText('Save'));
    expect(view.rename).toHaveBeenCalledTimes(1);
    expect(view.rename).toHaveBeenCalledWith('Model', 'Forecast');
  });
  test('engine failure remains visible with editable input', () => {
    const view = setup({
      onRename: () => {
        throw new Error('Sheet name is not valid');
      }
    });
    fireEvent.doubleClick(view.getByRole('tab', { name: 'Model' }));
    fireEvent.change(view.getByLabelText('Sheet name'), { target: { value: 'New' } });
    fireEvent.click(view.getByText('Save'));
    expect(view.getByRole('alert').textContent).toBe('Sheet name is not valid');
    expect(view.getByLabelText('Sheet name').getAttribute('aria-invalid')).toBe('true');
  });
  test('menu keyboard navigation and Escape return focus; last sheet cannot be deleted', () => {
    const view = setup({ sheets: ['Model'] });
    const trigger = view.getByRole('button', { name: 'Sheet actions for Model' });
    fireEvent.click(trigger);
    const rename = view.getByRole('menuitem', { name: /Rename/ });
    const remove = view.getByRole('menuitem', { name: 'Delete sheet' });
    expect(document.activeElement).toBe(rename);
    fireEvent.keyDown(rename, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(remove);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(remove);
    expect(view.remove).not.toHaveBeenCalled();
    fireEvent.keyDown(remove, { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
