/**
 * Permission catalog structural tests.
 *
 * These verify the catalog itself is internally consistent — no dangling
 * references, every key is unique, every role's permission list points
 * at real catalog entries, risk levels are valid, etc.
 *
 * Plus the role-isolation matrix that pins the RBAC spec:
 *   CEO       — full access
 *   Admin    — full access EXCEPT admin.ceo_role.manage
 *   Manager  — broad ops, no admin.* / system-level
 *   HR        — superset of Recruiter + Coordinator + HR-specific
 *   Recruiter — recruiting workflow only
 *   Coordinator — limited operational support
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  PERMISSIONS, SYSTEM_ROLES, CATEGORY_ORDER, CATEGORY_LABELS,
  CEO_TIER_PERMISSIONS, isCeoTierPermission,
} from '../catalog';

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
    const criticalPatterns = ['admin.roles.manage', 'admin.overrides.grant', 'finance.margins.view', 'admin.ceo_role.manage'];
    for (const p of PERMISSIONS) {
      if (criticalCategories.includes(p.category) || criticalPatterns.includes(p.key)) {
        assert.equal(p.risk, 'critical', `Expected ${p.key} to be critical risk`);
      }
    }
  });

  test('admin.ceo_role.manage exists and is critical', () => {
    const def = PERMISSIONS.find(p => p.key === 'admin.ceo_role.manage');
    assert.ok(def, 'admin.ceo_role.manage must exist — it is the CEO-protection meta-permission');
    assert.equal(def!.risk, 'critical');
  });
});

describe('SYSTEM_ROLES — the six default roles', () => {

  test('exactly the six spec roles exist (ceo, admin, manager, hr, recruiter, coordinator)', () => {
    const expected = ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator'];
    assert.deepEqual(
      SYSTEM_ROLES.map(r => r.key).sort(),
      expected.slice().sort(),
      'SYSTEM_ROLES should be exactly the six default roles per the RBAC spec'
    );
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
    const ceo = SYSTEM_ROLES.find(r => r.key === 'ceo')!;
    assert.equal(ceo.permissions.length, PERMISSIONS.length,
      `CEO should have all ${PERMISSIONS.length} permissions, has ${ceo.permissions.length}`);
  });

  test('Admin has every permission EXCEPT admin.ceo_role.manage', () => {
    const admin = SYSTEM_ROLES.find(r => r.key === 'admin')!;
    // Admin should be exactly PERMISSIONS minus admin.ceo_role.manage.
    const expected = PERMISSIONS.map(p => p.key)
      .filter(k => k !== 'admin.ceo_role.manage')
      .sort();
    assert.deepEqual(admin.permissions.slice().sort(), expected,
      'Admin should hold every permission except admin.ceo_role.manage');
  });

  test('Admin does NOT have admin.ceo_role.manage (the CEO-protection meta-perm)', () => {
    const admin = SYSTEM_ROLES.find(r => r.key === 'admin')!;
    assert.ok(!admin.permissions.includes('admin.ceo_role.manage'),
      'Admin must not have admin.ceo_role.manage — only CEO does');
  });

  test('Only CEO has admin.ceo_role.manage', () => {
    for (const role of SYSTEM_ROLES) {
      if (role.key === 'ceo') {
        assert.ok(role.permissions.includes('admin.ceo_role.manage'));
      } else {
        assert.ok(!role.permissions.includes('admin.ceo_role.manage'),
          `Role "${role.key}" must not hold admin.ceo_role.manage`);
      }
    }
  });

  test('Manager has broad operational perms but no admin.* / no CEO-tier', () => {
    const mgr = SYSTEM_ROLES.find(r => r.key === 'manager')!;
    // Operational: candidates, jobs, AI chat
    assert.ok(mgr.permissions.includes('candidates.view'));
    assert.ok(mgr.permissions.includes('jobs.view'));
    assert.ok(mgr.permissions.includes('jobs.edit'));
    assert.ok(mgr.permissions.includes('ai.chat.use'));
    assert.ok(mgr.permissions.includes('assignments.manage'));
    // No admin.* — manager should not be able to edit roles/permissions or
    // see security logs.
    const adminPerms = mgr.permissions.filter(p => p.startsWith('admin.'));
    assert.equal(adminPerms.length, 0, `Manager has admin perms: ${adminPerms.join(', ')}`);
    // No CEO-tier
    for (const perm of CEO_TIER_PERMISSIONS) {
      assert.ok(!mgr.permissions.includes(perm),
        `Manager must not hold CEO-tier permission: ${perm}`);
    }
  });

  test('HR is a superset of Recruiter + Coordinator', () => {
    const hr = new Set(SYSTEM_ROLES.find(r => r.key === 'hr')!.permissions);
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter')!.permissions;
    const coordinator = SYSTEM_ROLES.find(r => r.key === 'coordinator')!.permissions;
    for (const p of recruiter) {
      assert.ok(hr.has(p), `HR is missing recruiter permission: ${p}`);
    }
    for (const p of coordinator) {
      assert.ok(hr.has(p), `HR is missing coordinator permission: ${p}`);
    }
  });

  test('HR has HR-specific perms (employee files, incidents, onboarding manage, full credentialing/compliance)', () => {
    const hr = SYSTEM_ROLES.find(r => r.key === 'hr')!;
    assert.ok(hr.permissions.includes('hr.employee_files'));
    assert.ok(hr.permissions.includes('hr.incidents.manage'));
    assert.ok(hr.permissions.includes('onboarding.manage'));
    assert.ok(hr.permissions.includes('credentialing.edit'));
    assert.ok(hr.permissions.includes('credentialing.approve_docs'));
    assert.ok(hr.permissions.includes('compliance.policies.manage'));
  });

  test('HR does NOT have admin.* / CEO-tier / BD bids', () => {
    const hr = SYSTEM_ROLES.find(r => r.key === 'hr')!;
    const adminPerms = hr.permissions.filter(p => p.startsWith('admin.'));
    assert.equal(adminPerms.length, 0, `HR has admin perms: ${adminPerms.join(', ')}`);
    for (const perm of CEO_TIER_PERMISSIONS) {
      assert.ok(!hr.permissions.includes(perm),
        `HR must not hold CEO-tier permission: ${perm}`);
    }
    assert.ok(!hr.permissions.includes('bd.bids.view'),
      'HR should not see BD bids by default');
  });

  test('Recruiter has recruiting workflow perms only', () => {
    const r = SYSTEM_ROLES.find(r => r.key === 'recruiter')!;
    assert.ok(r.permissions.includes('candidates.view'));
    assert.ok(r.permissions.includes('candidates.create'));
    assert.ok(r.permissions.includes('candidates.edit'));
    assert.ok(r.permissions.includes('candidates.view.contact_info'));
    assert.ok(r.permissions.includes('jobs.view'));
    assert.ok(r.permissions.includes('submissions.view'));
    assert.ok(r.permissions.includes('submissions.create'));
    assert.ok(r.permissions.includes('pipeline.view'));
    assert.ok(r.permissions.includes('tasks.recruiter.view'));
  });

  test('Recruiter does NOT have HR / credentialing / compliance / onboarding / payroll / admin / CEO', () => {
    const r = SYSTEM_ROLES.find(r => r.key === 'recruiter')!;
    assert.ok(!r.permissions.includes('hr.view'));
    assert.ok(!r.permissions.includes('hr.employee_files'));
    assert.ok(!r.permissions.includes('credentialing.view'));
    assert.ok(!r.permissions.includes('credentialing.edit'));
    assert.ok(!r.permissions.includes('compliance.view'));
    assert.ok(!r.permissions.includes('onboarding.view'));
    assert.ok(!r.permissions.includes('finance.payroll.view'));
    assert.ok(!r.permissions.includes('finance.pay_rates.view'));
    const adminPerms = r.permissions.filter(p => p.startsWith('admin.'));
    assert.equal(adminPerms.length, 0, `Recruiter has admin perms: ${adminPerms.join(', ')}`);
    for (const perm of CEO_TIER_PERMISSIONS) {
      assert.ok(!r.permissions.includes(perm),
        `Recruiter must not hold CEO-tier permission: ${perm}`);
    }
  });

  test('Coordinator has limited operational support perms', () => {
    const c = SYSTEM_ROLES.find(r => r.key === 'coordinator')!;
    assert.ok(c.permissions.includes('candidates.view'));
    assert.ok(c.permissions.includes('candidates.view.contact_info'));
    assert.ok(c.permissions.includes('candidates.send_message'));
    assert.ok(c.permissions.includes('assignments.view'));
    assert.ok(c.permissions.includes('ai.chat.use'));
  });

  test('Coordinator does NOT have HR records / compliance docs / credentialing / payroll / admin', () => {
    const c = SYSTEM_ROLES.find(r => r.key === 'coordinator')!;
    assert.ok(!c.permissions.includes('hr.view'));
    assert.ok(!c.permissions.includes('hr.employee_files'));
    assert.ok(!c.permissions.includes('compliance.view'));
    assert.ok(!c.permissions.includes('credentialing.view'));
    assert.ok(!c.permissions.includes('finance.payroll.view'));
    const adminPerms = c.permissions.filter(p => p.startsWith('admin.'));
    assert.equal(adminPerms.length, 0, `Coordinator has admin perms: ${adminPerms.join(', ')}`);
    for (const perm of CEO_TIER_PERMISSIONS) {
      assert.ok(!c.permissions.includes(perm),
        `Coordinator must not hold CEO-tier permission: ${perm}`);
    }
  });

  test('Coordinator is a strict subset of HR', () => {
    const hr = new Set(SYSTEM_ROLES.find(r => r.key === 'hr')!.permissions);
    const coordinator = SYSTEM_ROLES.find(r => r.key === 'coordinator')!.permissions;
    for (const p of coordinator) {
      assert.ok(hr.has(p), `Coordinator perm "${p}" should be in HR's set (HR is a superset)`);
    }
  });

  test('Recruiter is a strict subset of HR', () => {
    const hr = new Set(SYSTEM_ROLES.find(r => r.key === 'hr')!.permissions);
    const recruiter = SYSTEM_ROLES.find(r => r.key === 'recruiter')!.permissions;
    for (const p of recruiter) {
      assert.ok(hr.has(p), `Recruiter perm "${p}" should be in HR's set (HR is a superset)`);
    }
  });

  test('HR is a strict subset of Manager', () => {
    const mgr = new Set(SYSTEM_ROLES.find(r => r.key === 'manager')!.permissions);
    const hr = SYSTEM_ROLES.find(r => r.key === 'hr')!.permissions;
    for (const p of hr) {
      assert.ok(mgr.has(p), `HR perm "${p}" should be in Manager's set (Manager is a superset)`);
    }
  });
});

describe('CEO-protection — meta-permissions and helpers', () => {

  test('CEO_TIER_PERMISSIONS includes admin.ceo_role.manage', () => {
    assert.ok(CEO_TIER_PERMISSIONS.includes('admin.ceo_role.manage'));
  });

  test('CEO_TIER_PERMISSIONS includes all ceo.* category perms', () => {
    for (const p of PERMISSIONS) {
      if (p.category === 'ceo') {
        assert.ok(CEO_TIER_PERMISSIONS.includes(p.key),
          `ceo-category permission "${p.key}" should be in CEO_TIER_PERMISSIONS`);
      }
    }
  });

  test('isCeoTierPermission flags CEO-tier perms', () => {
    assert.ok(isCeoTierPermission('admin.ceo_role.manage'));
    assert.ok(isCeoTierPermission('ceo.private_tasks'));
    assert.ok(isCeoTierPermission('finance.margins.view'));
    assert.ok(isCeoTierPermission('finance.payroll.view'));
    assert.ok(!isCeoTierPermission('candidates.view'));
    assert.ok(!isCeoTierPermission('admin.users.manage'));
  });

  test('every CEO_TIER_PERMISSIONS entry is a real permission', () => {
    const validKeys = new Set(PERMISSIONS.map(p => p.key));
    for (const k of CEO_TIER_PERMISSIONS) {
      assert.ok(validKeys.has(k), `CEO_TIER_PERMISSIONS contains unknown key: ${k}`);
    }
  });
});

describe('Acceptance tests — RBAC spec hierarchy', () => {

  // These cover the explicit "what each role can/cannot do" lines from
  // the RBAC spec.

  const get = (key: string) => SYSTEM_ROLES.find(r => r.key === key)!;

  test('CEO can do everything Admin can do (and more)', () => {
    const ceo = new Set(get('ceo').permissions);
    const admin = get('admin').permissions;
    for (const p of admin) {
      assert.ok(ceo.has(p), `CEO is missing admin permission: ${p}`);
    }
  });

  test('Admin has every permission except admin.ceo_role.manage', () => {
    const admin = new Set(get('admin').permissions);
    for (const p of PERMISSIONS) {
      if (p.key === 'admin.ceo_role.manage') {
        assert.ok(!admin.has(p.key), 'Admin must not hold admin.ceo_role.manage');
      } else {
        assert.ok(admin.has(p.key), `Admin must hold permission: ${p.key}`);
      }
    }
  });

  test('Manager cannot edit role permission definitions', () => {
    const mgr = get('manager');
    assert.ok(!mgr.permissions.includes('admin.permissions.edit'));
    assert.ok(!mgr.permissions.includes('admin.roles.manage'));
    assert.ok(!mgr.permissions.includes('admin.roles.create_custom'));
  });

  test('Manager cannot access system error logs / developer tools / integrations', () => {
    const mgr = get('manager');
    assert.ok(!mgr.permissions.includes('admin.security_logs.view'));
    assert.ok(!mgr.permissions.includes('admin.ai_logs.view'));
    assert.ok(!mgr.permissions.includes('admin.integrations.manage'));
  });

  test('Manager cannot manage users (broad user management is admin/CEO only)', () => {
    const mgr = get('manager');
    assert.ok(!mgr.permissions.includes('admin.users.manage'),
      'Per spec: only Admin and CEO can broadly manage users');
  });

  test('HR cannot access admin-only settings', () => {
    const hr = get('hr');
    assert.ok(!hr.permissions.includes('admin.users.manage'));
    assert.ok(!hr.permissions.includes('admin.permissions.edit'));
    assert.ok(!hr.permissions.includes('admin.security_logs.view'));
  });

  test('Recruiter cannot access credentialing, compliance, onboarding, payroll, system settings, role management', () => {
    const r = get('recruiter');
    assert.ok(!r.permissions.includes('credentialing.view'));
    assert.ok(!r.permissions.includes('compliance.view'));
    assert.ok(!r.permissions.includes('onboarding.view'));
    assert.ok(!r.permissions.includes('finance.payroll.view'));
    assert.ok(!r.permissions.includes('admin.users.manage'));
    assert.ok(!r.permissions.includes('admin.roles.manage'));
  });

  test('Coordinator cannot access sensitive HR records, compliance, credentialing, payroll, admin, system diagnostics', () => {
    const c = get('coordinator');
    assert.ok(!c.permissions.includes('hr.employee_files'));
    assert.ok(!c.permissions.includes('hr.incidents.view'));
    assert.ok(!c.permissions.includes('compliance.view'));
    assert.ok(!c.permissions.includes('credentialing.view'));
    assert.ok(!c.permissions.includes('finance.payroll.view'));
    assert.ok(!c.permissions.includes('admin.users.manage'));
    assert.ok(!c.permissions.includes('admin.roles.manage'));
    assert.ok(!c.permissions.includes('admin.security_logs.view'));
  });

  test('No role below CEO can hold admin.ceo_role.manage', () => {
    for (const role of SYSTEM_ROLES) {
      if (role.key !== 'ceo') {
        assert.ok(!role.permissions.includes('admin.ceo_role.manage'),
          `Role "${role.key}" must not hold admin.ceo_role.manage`);
      }
    }
  });
});
