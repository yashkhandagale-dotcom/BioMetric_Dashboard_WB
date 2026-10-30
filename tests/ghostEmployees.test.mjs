import test from 'node:test';
import assert from 'node:assert/strict';

function isGhostEmployee(employee) {
  const name = (employee.full_name || '').trim();
  const code = (employee.employee_code || '').trim();
  if (!name) return true;
  if (name.toLowerCase() === code.toLowerCase()) return true;
  if (!/[a-zA-Z]/.test(name)) return true;
  return false;
}

test('isGhostEmployee correctly identifies test cards and dummy entries', () => {
  // Test cards with code as name
  assert.equal(isGhostEmployee({ full_name: '250', employee_code: '250' }), true);
  assert.equal(isGhostEmployee({ full_name: '261', employee_code: '261' }), true);
  assert.equal(isGhostEmployee({ full_name: '276', employee_code: '276' }), true);
  assert.equal(isGhostEmployee({ full_name: '330', employee_code: '330' }), true);

  // Cards with only numbers or symbols, no letters
  assert.equal(isGhostEmployee({ full_name: '12345', employee_code: 'EMP99' }), true);
  assert.equal(isGhostEmployee({ full_name: '---', employee_code: '001' }), true);
  assert.equal(isGhostEmployee({ full_name: '', employee_code: 'EMP1' }), true);

  // Genuine employees with real names
  assert.equal(isGhostEmployee({ full_name: 'John Doe', employee_code: 'WB101' }), false);
  assert.equal(isGhostEmployee({ full_name: 'Aarav Patel', employee_code: '102' }), false);
  assert.equal(isGhostEmployee({ full_name: 'Siddhesh Wayal', employee_code: 'WB088' }), false);
  assert.equal(isGhostEmployee({ full_name: 'Priya S.', employee_code: '304' }), false);
});

