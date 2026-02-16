/**
 * YOGA BIBLE — ROLES & PERMISSIONS
 * Shared configuration for user roles and permission-based content gating.
 *
 * Roles:   member | trainee | student | teacher | marketing | admin
 * Gating:  data-yb-requires="permission-key"      (show if user has ANY listed permission)
 *          data-yb-role="role1,role2"               (show if user's role matches ANY listed)
 *          data-yb-hide-role="role1"                (hide if user's role matches)
 */
(function() {
  'use strict';

  // ── Role definitions ──
  var ROLES = {
    member:    { key: 'member',    icon: '👤', color: '#6F6A66' },
    trainee:   { key: 'trainee',   icon: '🎓', color: '#f75c03' },
    student:   { key: 'student',   icon: '📚', color: '#f75c03' },
    teacher:   { key: 'teacher',   icon: '🧘', color: '#f75c03' },
    marketing: { key: 'marketing', icon: '📣', color: '#3f99a5' },
    admin:     { key: 'admin',     icon: '⚙️', color: '#0F0F0F' }
  };

  // ── Trainee program branches ──
  var TRAINEE_PROGRAMS = {
    '100h': { label_da: '100-timer',  label_en: '100-Hour' },
    '200h': { label_da: '200-timer',  label_en: '200-Hour' },
    '300h': { label_da: '300-timer',  label_en: '300-Hour' },
    '500h': { label_da: '500-timer',  label_en: '500-Hour' }
  };

  // ── Student course branches ──
  var STUDENT_COURSES = {
    inversions:  { label_da: 'Inversions',   label_en: 'Inversions' },
    splits:      { label_da: 'Spagat',       label_en: 'Splits' },
    backbends:   { label_da: 'Rygbøjninger', label_en: 'Backbends' },
    handstands:  { label_da: 'Håndstand',    label_en: 'Handstands' },
    armbalances: { label_da: 'Armbalancer',  label_en: 'Arm Balances' },
    prenatal:    { label_da: 'Gravid yoga',  label_en: 'Prenatal Yoga' }
  };

  // ── Teacher type branches ──
  var TEACHER_TYPES = {
    vinyasa:     { label_da: 'Vinyasa',      label_en: 'Vinyasa' },
    yin:         { label_da: 'Yin',          label_en: 'Yin' },
    hot:         { label_da: 'Hot Yoga',     label_en: 'Hot Yoga' },
    ashtanga:    { label_da: 'Ashtanga',     label_en: 'Ashtanga' },
    hatha:       { label_da: 'Hatha',        label_en: 'Hatha' },
    kids:        { label_da: 'Børneyoga',    label_en: 'Kids Yoga' },
    restorative: { label_da: 'Restorative',  label_en: 'Restorative' },
    prenatal:    { label_da: 'Gravidyoga',   label_en: 'Prenatal' },
    meditation:  { label_da: 'Meditation',   label_en: 'Meditation' }
  };

  // ── Role labels (bilingual) ──
  var ROLE_LABELS = {
    member:    { da: 'Medlem',                  en: 'Member' },
    trainee:   { da: 'Yogalærer-studerende',    en: 'Teacher Trainee' },
    student:   { da: 'Kursusdeltager',          en: 'Course Student' },
    teacher:   { da: 'Yogalærer',               en: 'Teacher' },
    marketing: { da: 'Marketing',               en: 'Marketing' },
    admin:     { da: 'Administrator',            en: 'Administrator' }
  };

  // ── Base permissions per role ──
  var ROLE_PERMISSIONS = {
    member:    ['gated-content'],
    trainee:   ['gated-content', 'live-streaming', 'recordings'],
    student:   ['gated-content'],
    teacher:   ['gated-content', 'live-streaming', 'recordings'],
    marketing: ['gated-content', 'admin:content'],
    admin:     ['gated-content', 'live-streaming', 'recordings', 'admin:content', 'admin:courses', 'admin:users']
  };

  /**
   * Compute the full permission set for a user from their role + roleDetails.
   * @param {string} role
   * @param {object} roleDetails  e.g. { program: '200h' } or { teacherType: 'vinyasa' }
   * @returns {string[]}
   */
  function computePermissions(role, roleDetails) {
    var base = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.member;
    var perms = base.slice(); // copy
    roleDetails = roleDetails || {};

    // Trainee: grant access to their specific program materials
    if (role === 'trainee' && roleDetails.program) {
      perms.push('materials:' + roleDetails.program);
    }

    // Teacher: grant access to all program materials + their speciality
    if (role === 'teacher') {
      Object.keys(TRAINEE_PROGRAMS).forEach(function(p) {
        if (perms.indexOf('materials:' + p) === -1) perms.push('materials:' + p);
      });
      if (roleDetails.teacherType) {
        perms.push('teacher:' + roleDetails.teacherType);
      }
    }

    // Admin: grant everything
    if (role === 'admin') {
      Object.keys(TRAINEE_PROGRAMS).forEach(function(p) {
        if (perms.indexOf('materials:' + p) === -1) perms.push('materials:' + p);
      });
      perms.push('admin:courses', 'admin:users', 'admin:content');
      // Deduplicate
      var seen = {};
      perms = perms.filter(function(p) {
        if (seen[p]) return false;
        seen[p] = true;
        return true;
      });
    }

    return perms;
  }

  /**
   * Get the display label for a role.
   * @param {string} role
   * @param {string} lang  'da' or 'en'
   * @returns {string}
   */
  function getRoleLabel(role, lang) {
    var entry = ROLE_LABELS[role];
    if (!entry) return role;
    return entry[lang] || entry.da;
  }

  /**
   * Get a human-readable description of the role branch (program, course type, teacher type).
   * @param {string} role
   * @param {object} roleDetails
   * @param {string} lang
   * @returns {string}
   */
  function getRoleDetail(role, roleDetails, lang) {
    roleDetails = roleDetails || {};
    lang = lang || 'da';

    if (role === 'trainee' && roleDetails.program) {
      var prog = TRAINEE_PROGRAMS[roleDetails.program];
      return prog ? prog['label_' + lang] || prog.label_da : roleDetails.program;
    }
    if (role === 'teacher' && roleDetails.teacherType) {
      var tt = TEACHER_TYPES[roleDetails.teacherType];
      return tt ? tt['label_' + lang] || tt.label_da : roleDetails.teacherType;
    }
    return '';
  }

  /**
   * Apply permission-based visibility to the DOM.
   * Elements with data-yb-requires="perm1,perm2" are shown if the user has ANY of them.
   * @param {string[]} permissions
   */
  function applyPermissions(permissions) {
    permissions = permissions || [];
    document.querySelectorAll('[data-yb-requires]').forEach(function(el) {
      var required = el.getAttribute('data-yb-requires');
      var keys = required.split(',').map(function(k) { return k.trim(); });
      var hasAccess = keys.some(function(k) { return permissions.indexOf(k) !== -1; });
      el.style.display = hasAccess ? '' : 'none';
    });
  }

  /**
   * Apply role-based visibility to the DOM.
   * data-yb-role="role1,role2"       → shown if user role matches any
   * data-yb-hide-role="role1,role2"   → hidden if user role matches any
   * @param {string} role
   */
  function applyRole(role) {
    role = role || 'member';
    document.querySelectorAll('[data-yb-role]').forEach(function(el) {
      var allowed = el.getAttribute('data-yb-role').split(',').map(function(k) { return k.trim(); });
      el.style.display = allowed.indexOf(role) !== -1 ? '' : 'none';
    });
    document.querySelectorAll('[data-yb-hide-role]').forEach(function(el) {
      var hidden = el.getAttribute('data-yb-hide-role').split(',').map(function(k) { return k.trim(); });
      el.style.display = hidden.indexOf(role) !== -1 ? 'none' : '';
    });
  }

  // ── Expose globally ──
  window.YBRoles = {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    TRAINEE_PROGRAMS: TRAINEE_PROGRAMS,
    STUDENT_COURSES: STUDENT_COURSES,
    TEACHER_TYPES: TEACHER_TYPES,
    ROLE_PERMISSIONS: ROLE_PERMISSIONS,
    computePermissions: computePermissions,
    getRoleLabel: getRoleLabel,
    getRoleDetail: getRoleDetail,
    applyPermissions: applyPermissions,
    applyRole: applyRole
  };

  console.log('✅ Roles & Permissions module loaded');
})();
