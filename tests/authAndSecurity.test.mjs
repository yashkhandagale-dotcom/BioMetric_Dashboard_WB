import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Timing-safe comparison function
function timingSafeCompare(provided, expected) {
  if (!provided || !expected) return false;
  const bufA = Buffer.from(provided);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) {
    // Constant time dummy comparison to resist length timing attacks
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

test('timingSafeCompare correctly validates secrets in constant time', () => {
  const secret = 'super_secret_cron_key_998877';

  // Exact match
  assert.equal(timingSafeCompare('super_secret_cron_key_998877', secret), true);

  // Different value, same length
  assert.equal(timingSafeCompare('super_secret_cron_key_998878', secret), false);

  // Different length
  assert.equal(timingSafeCompare('short', secret), false);
  assert.equal(timingSafeCompare('super_secret_cron_key_998877_extra', secret), false);

  // Empty or null
  assert.equal(timingSafeCompare('', secret), false);
  assert.equal(timingSafeCompare(null, secret), false);
  assert.equal(timingSafeCompare('Bearer secret', null), false);
});

// Self-approval policy check
function canApproveLeaveRequest(approver, request) {
  // Hard rule: No employee may ever approve their own leave request
  if (approver.id === request.employee_id) {
    return { allowed: false, reason: 'Self-approval is prohibited' };
  }

  // HR admin / HR super admin can approve
  if (approver.role === 'hr' || approver.role === 'hr_super_admin') {
    return { allowed: true };
  }

  // Manager or lead must be in the employee's management hierarchy
  if (approver.role === 'manager' || approver.role === 'lead') {
    if (approver.managedEmployeeIds?.includes(request.employee_id)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Employee is not in your management hierarchy' };
  }

  return { allowed: false, reason: 'Unauthorized role' };
}

test('canApproveLeaveRequest blocks self-approval even for managers and HR', () => {
  const manager = {
    id: 'emp-mgr-1',
    role: 'manager',
    managedEmployeeIds: ['emp-mgr-1', 'emp-dev-2', 'emp-dev-3'],
  };

  const devRequest = { id: 'req-1', employee_id: 'emp-dev-2' };
  const managerOwnRequest = { id: 'req-2', employee_id: 'emp-mgr-1' };

  // Manager approving subordinate -> allowed
  assert.deepEqual(canApproveLeaveRequest(manager, devRequest), { allowed: true });

  // Manager approving their own request -> BLOCKED
  const selfApproval = canApproveLeaveRequest(manager, managerOwnRequest);
  assert.equal(selfApproval.allowed, false);
  assert.equal(selfApproval.reason, 'Self-approval is prohibited');

  // Ordinary employee trying to approve -> BLOCKED
  const employee = { id: 'emp-dev-2', role: 'employee' };
  assert.equal(canApproveLeaveRequest(employee, devRequest).allowed, false);
});

// Shared Link TTL and expiration check
test('Shared links reject expired tokens', () => {
  const now = Date.now();
  const validLink = { token: 'tok_abc123', expiresAt: new Date(now + 3600000).toISOString() };
  const expiredLink = { token: 'tok_old999', expiresAt: new Date(now - 1000).toISOString() };

  function isLinkActive(link) {
    if (!link || !link.expiresAt) return false;
    return new Date(link.expiresAt).getTime() > Date.now();
  }

  assert.equal(isLinkActive(validLink), true);
  assert.equal(isLinkActive(expiredLink), false);
});

