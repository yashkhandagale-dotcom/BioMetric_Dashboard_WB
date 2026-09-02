# New Joiner Acknowledgment & Rejection Feature

## Overview
Added admin capability to acknowledge or reject new joiners (pending signups) with optional rejection notes.

## Changes Made

### 1. Database Migration
**File**: `supabase/migrations/0020_new_joiner_acknowledgment.sql`

Added to `pending_employee_signups` table:
- `status` (text): pending | acknowledged | rejected
- `acknowledged_at` (timestamptz): When HR acknowledged the signup
- `acknowledged_by` (uuid): User ID of HR who acknowledged
- `rejected_at` (timestamptz): When HR rejected the signup
- `rejected_by` (uuid): User ID of HR who rejected
- `rejection_reason` (text): Optional note/reason for rejection

**Index**: Added on (status, created_at) for efficient filtering.

### 2. API Routes

#### POST `/api/leave/admin/pending-signups/[id]/acknowledge`
Marks a pending signup as acknowledged with timestamp and who acknowledged it.
- **Auth**: HR & HR Super Admin only
- **Body**: None required
- **Response**: Updated signup record

#### POST `/api/leave/admin/pending-signups/[id]/reject`
Rejects a pending signup with optional reason.
- **Auth**: HR & HR Super Admin only
- **Body**: `{ rejectionReason?: string }` (max 500 chars)
- **Response**: Updated signup record with rejection details

#### GET `/api/leave/admin/pending-signups`
**Updated**: Now filters only `status='pending'` signups to exclude acknowledged/rejected.

### 3. Updated Routes

#### POST `/api/leave/employees`
**Changed**: Instead of deleting pending_employee_signups, now updates:
- `status = 'acknowledged'`
- `acknowledged_at` = current timestamp
- `acknowledged_by` = requester's ID

This preserves audit trail of when & who acknowledged.

### 4. UI Components

#### `components/leave/NewJoinersPanel.tsx` - Major Update
**New Features**:
- **Reject Button**: Red button next to each joiner
- **Reject Modal**: Shows when Reject is clicked
  - Optional text field for rejection reason (max 500 chars)
  - Character counter
  - Cancel & Reject buttons
  - Disables during submission
- **Acknowledge Button**: Green button (already existed, unchanged)
- **State Management**: Separate `rejecting` state for reject modal
- **Keyboard Support**: ESC key closes both modals
- **Responsive**: Works on mobile and desktop

#### `app/leave/pending/page.tsx` - Enhanced
**New Feature**:
- Shows rejection status when user has been rejected
- Displays rejection reason if provided
- Red styling to indicate rejection
- Professional "Registration Rejected" message
- Clear guidance to contact HR

### 5. Data Flow

**Acknowledge Flow**:
```
HR clicks Acknowledge 
  → Opens AddEmployeeForm modal
  → HR fills in employee details
  → Creates employee record
  → Updates pending_signup status='acknowledged'
  → Employee can now access dashboard
```

**Reject Flow**:
```
HR clicks Reject
  → Opens reject modal
  → HR enters optional reason (e.g., "Duplicate account", "Invalid credentials")
  → HR clicks Reject
  → Updates pending_signup status='rejected'
  → User sees rejection message on next login
  → Removed from pending queue
```

## User Experience

### For HR Admin:
1. New joiners panel shows pending signups with count
2. Each joiner row shows:
   - Avatar/initials
   - Name and email
   - Time since sign-in
   - "Acknowledge" button (green, pulsing for first row)
   - "Reject" button (red)
3. Click Acknowledge → Employee form opens
4. Click Reject → Modal with optional reason field
5. Rejection confirms before removing from queue

### For New Joiner:
1. **If Acknowledged**: Gets redirected to onboarding form → dashboard
2. **If Rejected**: 
   - Stays on pending page
   - Sees "Registration Rejected" message
   - Sees rejection reason if provided
   - Directed to contact HR

## Security
- HR role check on all endpoints
- Pending signup validation before updates
- Auth user ID linking prevents account hijacking
- Rejection reason limited to 500 characters
- Audit trail preserved (who/when acknowledged/rejected)

## Testing Checklist

- [ ] HR can see pending signups in admin panel
- [ ] Acknowledge button opens form with pre-filled email
- [ ] Acknowledge creates employee and updates status
- [ ] Reject button opens modal
- [ ] Reject updates status and stores reason
- [ ] Rejected user sees rejection message
- [ ] Rejected user sees optional reason
- [ ] Acknowledged user redirected to onboarding
- [ ] ESC key closes modals
- [ ] Non-HR users cannot access endpoints
- [ ] Character limit enforced (500 chars)
- [ ] Empty queue hides panel

## Migration Instructions

1. Apply migration: `0020_new_joiner_acknowledgment.sql`
2. Deploy updated code
3. Clear browser cache if needed
4. Test flows above

## Files Modified

1. `supabase/migrations/0020_new_joiner_acknowledgment.sql` (NEW)
2. `app/api/leave/admin/pending-signups/[id]/acknowledge/route.ts` (NEW)
3. `app/api/leave/admin/pending-signups/[id]/reject/route.ts` (NEW)
4. `app/api/leave/admin/pending-signups/route.ts` (UPDATED)
5. `app/api/leave/employees/route.ts` (UPDATED)
6. `components/leave/NewJoinersPanel.tsx` (UPDATED)
7. `app/leave/pending/page.tsx` (UPDATED)
