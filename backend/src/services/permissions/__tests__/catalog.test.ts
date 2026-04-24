/**
 * Permission catalog structural tests.
 *
 * These verify the catalog itself is internally consistent — no dangling
 * references, every key is unique, every role's permission list points
 * at real catalog entries, risk levels are valid, etc.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { PERMISSIONS, SYSTEM_ROLES, CATEGORY_ORDER, CATEGORY_LABELS } from '../catalog';

describe('PERMISSIONS catalog', () => {

  test('every permission has required fields', () => {
    for (const p of PERMISSIONS) {
      assert.ok(p.key, `Permission missing key: ${JSON.stringify(p)}`);
      assert.ok(p.category, `Permission ${p.key} missing category`);
      assert.ok(p.label, `Permission ${p.key} missing label`);
      assert.ok(p.description, `Permission ${p.key} missing description`);
      assert.ok(p.risk, `Permission ${p.key} missing risk`);
    }
  });

  test('every permission key is unique', () => {
    const seen = new Set<string>();
    for (const p of PERMISSIONS) {
      assert.ok(!seen.has(p.key), `Duplicate permission key: ${p.key}`);
      seen.add(p.key);
    }
  });

  test('every permission key uses dotted.lowercase.underscore format', () => {
    const pattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
    for (const p of PERMISSIONS) {
      assert.ok(pattern.test(p.key), `Invalid key format: ${p.key}`);
    }
  });

  test('every risk level is one of the 4 valid values', () => {
    const valid = new Set(['low', 'medium', 'high', 'critical']);
    for (const p of PERMISSIONS) {
      assert.ok(valid.has(p.risk), `Invalid risk for ${p.key}: ${p.risk}`);
    }
  });

  test('every permission category is in CATEGORY_ORDER', () => {
    for (const p of PERMISSIONS) {
      assert.ok(
        CATEGORY_ORDER.includes(p.category),
        `Permission ${p.key} has unknown category: ${p.category}. Add it to CATEGORY_ORDER.`
      );
    }
  });

  test('every CATEGORY_ORDER entry has a label', () => {
    for (const cat of CATEGORY_ORDER) {
      assert.ok(CATEGORY_LABELS[cat], `Category ${cat} missing label in CATEGORY_LABELS`);
    }
  });

  test('at least one critical permission exists (proving risk levels are used)', () => {
    const criticals = PERMISSIONS.filter(p => p.risk === 'critical');
    assert.ok(criticals.length > 0, 'Expected at least one critical permission');
  });

  test('CEO-private + finance + admin permissions are critical risk', () => {
    const criticalCategories = ['ceo'];
    const criticalPatterns = ['admin.roles.manage', 'admin.overrides.grant', 'finance.margins.view'];
    for (const p of PERMISSIONS) {
      if (criticalCategories.includes(p.category) || criticalPatterns.includes(p.key)) {
        assert.equal(p.risk, 'critical', `Expected ${p.key} to be critical risk`);
      }
    }
  });
});

describe('SYSTEM_ROLES', () => {

  test('CEO / admin / manager / hr / recruiter / credentialing / compliance / bd / staff all exist', () => {
    const expected = ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'credentialing', 'compliance', 'bd', 'staff'];
    for (const e of expected) {
      assert.ok(SYSTEM_ROLES.find(r => r.key === e), `Missing system role: ${e}`);
    }
  });

  test('every role references only real permission keys', () => {
    const validKeys = new Set(PERMISSIONS.map(p => p.key));
    for (const role of SYSTEM_ROLES) {
      for (const permKey of role.permissions) {
        assert.ok(
          validKeys.has(permKey),
          `Role "${role.key}" references unknown permission: ${permKey}`
        );
      }
    }
  });

  test('CEO has all permissions', () => {
    const ceo = SYSTEM_ROLES.find(r => r.key === 'ceo');
    assert.ok(ceo);
    assert.equal(ceo!.permissions.length, PERMISSIONS.length,
      `CEO should have all ${PERMISSIONS.length} permissions, has ${ceo!.permissions.length}`);
  });

  test('Recruiter does NOT have finance permissions', () => {
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter');
    assert.ok(recruiter);
    const financePerms = recruiter!.permissions.filter(p => p.startsWith('finance.'));
    assert.equal(financePerms.length, 0, `Recruiter has finance perms: ${financePerms.join(', ')}`);
  });

  test('Recruiter does NOT have CEO permissions', () => {
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter');
    assert.ok(recruiter);
    const ceoPerms = recruiter!.permissions.filter(p => p.startsWith('ceo.'));
    assert.equal(ceoPerms.length, 0, `Recruiter has CEO perms: ${ceoPerms.join(', ')}`);
  });

  test('Recruiter does NOT have bids permissions', () => {
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter');
    assert.ok(recruiter);
    const bdPerms = recruiter!.permissions.filter(p => p.startsWith('bd.'));
    assert.equal(bdPerms.length, 0, `Recruiter has BD perms: ${bdPerms.join(', ')}`);
  });

  test('Recruiter does NOT have admin permissions', () => {
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter');
    assert.ok(recruiter);
    const adminPerms = recruiter!.permissions.filter(p => p.startsWith('admin.'));
    assert.equal(adminPerms.length, 0, `Recruiter has admin perms: ${adminPerms.join(', ')}`);
  });

  test('Recruiter does NOT have HR employee_files permission', () => {
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter');
    assert.ok(recruiter);
    assert.ok(!recruiter!.permissions.includes('hr.employee_files'));
  });

  test('Recruiter does NOT have AI finance topic', () => {
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter');
    assert.ok(recruiter);
    assert.ok(!recruiter!.permissions.includes('ai.topic.finance'));
  });

  test('HR does NOT have CEO permissions', () => {
    const hr = SYSTEM_ROLES.find(r => r.key === 'hr');
    assert.ok(hr);
    const ceoPerms = hr!.permissions.filter(p => p.startsWith('ceo.'));
    assert.equal(ceoPerms.length, 0);
  });

  test('HR does NOT have bids permissions', () => {
    const hr = SYSTEM_ROLES.find(r => r.key === 'hr');
    assert.ok(hr);
    const bdPerms = hr!.permissions.filter(p => p.startsWith('bd.'));
    assert.equal(bdPerms.length, 0);
  });

  test('HR does NOT have finance margins', () => {
    const hr = SYSTEM_ROLES.find(r => r.key === 'hr');
    assert.ok(hr);
    assert.ok(!hr!.permissions.includes('finance.margins.view'));
  });

  test('HR has employee_files + onboarding + HR incidents', () => {
    const hr = SYSTEM_ROLES.find(r => r.key === 'hr');
    assert.ok(hr);
    assert.ok(hr!.permissions.includes('hr.employee_files'));
    assert.ok(hr!.permissions.includes('onboarding.manage'));
    assert.ok(hr!.permissions.includes('hr.incidents.manage'));
  });

  test('Credentialing has candidate medical + credential edit', () => {
    const cred = SYSTEM_ROLES.find(r => r.key === 'credentialing');
    assert.ok(cred);
    assert.ok(cred!.permissions.includes('candidates.view.medical'));
    assert.ok(cred!.permissions.includes('credentialing.edit'));
    assert.ok(cred!.permissions.includes('credentialing.approve_docs'));
  });

  test('Credentialing does NOT have finance permissions', () => {
    const cred = SYSTEM_ROLES.find(r => r.key === 'credentialing');
    assert.ok(cred);
    const fin = cred!.permissions.filter(p => p.startsWith('finance.'));
    assert.equal(fin.length, 0);
  });

  test('BD has bid/lead/contact permissions but NOT CEO-sensitive bid notes', () => {
    const bd = SYSTEM_ROLES.find(r => r.key === 'bd');
    assert.ok(bd);
    assert.ok(bd!.permissions.includes('bd.bids.edit'));
    assert.ok(bd!.permissions.includes('bd.leads.view'));
    assert.ok(!bd!.permissions.includes('bd.ceo_sensitive_notes'),
      'BD role should NOT get ceo_sensitive_notes by default');
  });

  test('Manager has operational perms but NOT finance margins / payroll / revenue', () => {
    const mgr = SYSTEM_ROLES.find(r => r.key === 'manager');
    assert.ok(mgr);
    assert.ok(mgr!.permissions.includes('candidates.view'));
    assert.ok(mgr!.permissions.includes('ai.chat.use'));
    assert.ok(!mgr!.permissions.includes('finance.margins.view'),
      'Manager should NOT get margin view by default');
    assert.ok(!mgr!.permissions.includes('finance.payroll.view'));
    assert.ok(!mgr!.permissions.includes('finance.revenue_reports.view'));
  });

  test('Manager does NOT have admin.roles.manage', () => {
    const mgr = SYSTEM_ROLES.find(r => r.key === 'manager');
    assert.ok(mgr);
    assert.ok(!mgr!.permissions.includes('admin.roles.manage'));
  });

  test('Admin does NOT have CEO private permissions', () => {
    const admin = SYSTEM_ROLES.find(r => r.key === 'admin');
    assert.ok(admin);
    const ceoPerms = admin!.permissions.filter(p => p.startsWith('ceo.'));
    assert.equal(ceoPerms.length, 0, `Admin should not get CEO perms: ${ceoPerms.join(', ')}`);
    assert.ok(!admin!.permissions.includes('bd.ceo_sensitive_notes'));
    assert.ok(!admin!.permissions.includes('finance.margins.view'));
  });

  test('Staff role has minimal perms (only own PTO + AI chat)', () => {
    const staff = SYSTEM_ROLES.find(r => r.key === 'staff');
    assert.ok(staff);
    assert.ok(staff!.permissions.length <= 5, 'Staff should have very limited permissions');
    assert.ok(staff!.permissions.includes('pto.view_own'));
    // No candidate, finance, HR, or admin access
    const forbidden = staff!.permissions.filter(p =>
      p.startsWith('candidates.') ||
      p.startsWith('finance.') ||
      p.startsWith('admin.') ||
      p.startsWith('ceo.')
    );
    assert.equal(forbidden.length, 0,
      `Staff has forbidden perms: ${forbidden.join(', ')}`);
  });
});

describe('Acceptance tests — role isolation matrix', () => {

  // These cover the specific scenarios from the original security spec:
  // "recruiter cannot access X", "HR cannot access Y", etc.

  const get = (key: string) => SYSTEM_ROLES.find(r => r.key === key)!;

  test('Recruiter cannot access CEO tasks', () => {
    assert.ok(!get('recruiter').permissions.includes('ceo.private_tasks'));
    assert.ok(!get('recruiter').permissions.includes('ai.topic.ceo'));
  });

  test('Recruiter cannot access bid strategy', () => {
    assert.ok(!get('recruiter').permissions.includes('bd.strategic_notes.view'));
    assert.ok(!get('recruiter').permissions.includes('bd.ceo_sensitive_notes'));
    assert.ok(!get('recruiter').permissions.includes('ai.topic.bids'));
  });

  test('Recruiter cannot access finance/payroll', () => {
    assert.ok(!get('recruiter').permissions.includes('finance.pay_rates.view'));
    assert.ok(!get('recruiter').permissions.includes('finance.margins.view'));
    assert.ok(!get('recruiter').permissions.includes('finance.payroll.view'));
    assert.ok(!get('recruiter').permissions.includes('finance.revenue_reports.view'));
  });

  test('Recruiter cannot search full SharePoint (no bids, HR, CEO folders)', () => {
    assert.ok(!get('recruiter').permissions.includes('files.hr.search'));
    assert.ok(!get('recruiter').permissions.includes('files.bids.search'));
    assert.ok(!get('recruiter').permissions.includes('files.ceo_private.search'));
    assert.ok(!get('recruiter').permissions.includes('files.credentialing.search'));
  });

  test('Recruiter CAN access their assigned candidates + jobs + tasks', () => {
    const r = get('recruiter');
    assert.ok(r.permissions.includes('candidates.view'));
    assert.ok(r.permissions.includes('jobs.view'));
    assert.ok(r.permissions.includes('submissions.view'));
    assert.ok(r.permissions.includes('tasks.recruiter.view'));
  });

  test('HR cannot access CEO/private areas', () => {
    const hr = get('hr');
    assert.ok(!hr.permissions.includes('ceo.private_tasks'));
    assert.ok(!hr.permissions.includes('ceo.executive_strategy'));
    assert.ok(!hr.permissions.includes('ai.topic.ceo'));
  });

  test('HR cannot access bid strategy notes', () => {
    const hr = get('hr');
    assert.ok(!hr.permissions.includes('bd.strategic_notes.view'));
    assert.ok(!hr.permissions.includes('ai.topic.bids'));
  });

  test('HR cannot access finance/payroll', () => {
    const hr = get('hr');
    assert.ok(!hr.permissions.includes('finance.payroll.view'));
    assert.ok(!hr.permissions.includes('finance.margins.view'));
    assert.ok(!hr.permissions.includes('finance.revenue_reports.view'));
  });

  test('Credentialing cannot access unrelated CEO/bid/private data', () => {
    const cred = get('credentialing');
    assert.ok(!cred.permissions.includes('ceo.private_tasks'));
    assert.ok(!cred.permissions.includes('bd.bids.view'));
    assert.ok(!cred.permissions.includes('finance.margins.view'));
  });

  test('Manager can see operational team work but NOT CEO-private/finance/margins', () => {
    const mgr = get('manager');
    assert.ok(mgr.permissions.includes('candidates.view'));
    assert.ok(mgr.permissions.includes('jobs.view'));
    assert.ok(!mgr.permissions.includes('ceo.private_tasks'));
    assert.ok(!mgr.permissions.includes('finance.margins.view'));
    assert.ok(!mgr.permissions.includes('finance.payroll.view'));
  });

  test('CEO can access everything', () => {
    const ceo = get('ceo');
    assert.equal(ceo.permissions.length, PERMISSIONS.length);
  });
});
