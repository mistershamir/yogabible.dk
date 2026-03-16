#!/usr/bin/env python3
"""
Audit Drip Migration — Check current state of agent drips vs Netlify sequences.

Queries lead_drip_sequences for active drips and checks for overlap with
sequence_enrollments. Outputs a clear report for migration planning.

Usage:
    python -m tools.audit_drip_migration        # Run from lead-agent/
    python tools/audit_drip_migration.py         # Or directly
"""

import os
import sys
from datetime import datetime, timezone
from collections import defaultdict

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from tools.firestore import get_db
except ImportError:
    # Direct execution fallback
    import firebase_admin
    from firebase_admin import credentials, firestore

    cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS',
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     'firebase-service-account.json'))
    if not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)

    def get_db():
        return firestore.client()


def run_audit():
    db = get_db()
    now = datetime.now(timezone.utc)

    print('')
    print('╔═══════════════════════════════════════════════════════════════╗')
    print('║         Drip Migration Audit — Yoga Bible Lead Agent        ║')
    print('╚═══════════════════════════════════════════════════════════════╝')
    print(f'  Timestamp: {now.isoformat()}')
    print('')

    # ── 1. Active agent drips ───────────────────────────────────────────
    print('── Active Agent Drips (lead_drip_sequences) ──────────────────')
    drips = db.collection('lead_drip_sequences').stream()

    active_drips = []
    completed_drips = 0
    paused_drips = 0
    total_drips = 0
    by_step = defaultdict(int)
    by_program = defaultdict(int)

    for doc in drips:
        total_drips += 1
        data = doc.to_dict()

        if data.get('completed', False):
            completed_drips += 1
            continue
        if data.get('paused', False):
            paused_drips += 1
            continue

        # Active drip
        lead_id = doc.id
        step = data.get('current_step', '?')
        next_send = data.get('next_send_at', 'unknown')
        program = data.get('program_type', 'unknown')
        email = data.get('lead_email', 'unknown')

        active_drips.append({
            'lead_id': lead_id,
            'email': email,
            'step': step,
            'next_send_at': next_send,
            'program_type': program
        })

        by_step[str(step)] += 1
        by_program[program] += 1

    print(f'  Total drip docs: {total_drips}')
    print(f'  Active: {len(active_drips)} | Paused: {paused_drips} | Completed: {completed_drips}')
    print('')

    if active_drips:
        print('  By step:')
        for step, count in sorted(by_step.items()):
            print(f'    Step {step}: {count}')

        print('  By program:')
        for prog, count in sorted(by_program.items()):
            print(f'    {prog}: {count}')
        print('')

        print('  Active drip details:')
        for d in active_drips:
            next_dt = d['next_send_at']
            if hasattr(next_dt, 'isoformat'):
                next_str = next_dt.isoformat()
                # Check if overdue
                if next_dt.replace(tzinfo=timezone.utc) < now:
                    next_str += ' ⚠️ OVERDUE'
            else:
                next_str = str(next_dt)

            print(f'    • {d["email"]} | Step {d["step"]} | Next: {next_str} | Program: {d["program_type"]}')
    else:
        print('  ✅ No active agent drips found.')
    print('')

    # ── 2. Check for overlap with Netlify sequences ─────────────────────
    print('── Overlap Check (agent drips ∩ Netlify sequences) ───────────')

    overlaps = []
    for drip in active_drips:
        lead_id = drip['lead_id']
        enrollments = db.collection('sequence_enrollments') \
            .where('lead_id', '==', lead_id) \
            .where('status', 'in', ['active', 'paused']) \
            .limit(1) \
            .get()

        if len(enrollments.docs) > 0:
            enrollment = enrollments.docs[0].to_dict()
            overlaps.append({
                'lead_id': lead_id,
                'email': drip['email'],
                'agent_step': drip['step'],
                'netlify_sequence': enrollment.get('sequence_name', 'unknown'),
                'netlify_step': enrollment.get('current_step', '?')
            })

    if overlaps:
        print(f'  ⚠️  {len(overlaps)} leads are in BOTH systems:')
        for o in overlaps:
            print(f'    • {o["email"]} — Agent step {o["agent_step"]} + Netlify "{o["netlify_sequence"]}" step {o["netlify_step"]}')
    else:
        print('  ✅ No overlaps found.')
    print('')

    # ── 3. Netlify sequence enrollments summary ─────────────────────────
    print('── Netlify Sequence Enrollments (sequence_enrollments) ───────')
    enrollments = db.collection('sequence_enrollments').stream()

    by_status = defaultdict(int)
    by_sequence = defaultdict(lambda: defaultdict(int))
    total_enrollments = 0

    for doc in enrollments:
        total_enrollments += 1
        data = doc.to_dict()
        status = data.get('status', 'unknown')
        seq_name = data.get('sequence_name', 'unknown')
        by_status[status] += 1
        by_sequence[seq_name][status] += 1

    print(f'  Total enrollments: {total_enrollments}')
    for status, count in sorted(by_status.items()):
        print(f'    {status}: {count}')
    print('')

    if by_sequence:
        print('  By sequence:')
        for seq_name, statuses in sorted(by_sequence.items()):
            parts = [f'{s}={c}' for s, c in sorted(statuses.items())]
            print(f'    "{seq_name}": {", ".join(parts)}')
    print('')

    # ── 4. Summary & recommendations ────────────────────────────────────
    print('── Migration Recommendations ────────────────────────────────')
    if len(active_drips) == 0:
        print('  ✅ No active agent drips. Safe to disable drip scheduler.')
    elif len(active_drips) <= 5:
        print(f'  ⏳ {len(active_drips)} active drips remaining. Let them finish (~10 days max).')
        print('     Add migration guards now to prevent new drips.')
    else:
        print(f'  ⚠️  {len(active_drips)} active drips. Add migration guards and let them wind down.')

    if overlaps:
        print(f'  ⚠️  {len(overlaps)} overlapping leads need manual review to prevent duplicates.')

    print('')
    print('Done.')
    return {
        'active_drips': len(active_drips),
        'completed_drips': completed_drips,
        'paused_drips': paused_drips,
        'overlaps': len(overlaps),
        'netlify_enrollments': total_enrollments
    }


if __name__ == '__main__':
    run_audit()
