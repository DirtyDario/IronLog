import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../lib/db/schema';
import { importExercises, type ImportPreview } from '../lib/services/exerciseImport';

describe('importExercises', () => {
    beforeEach(async () => {
        await db.exercises.clear();
    });

    it('imports selected exercises into DB', async () => {
        const previews: ImportPreview[] = [
            { wgerId: 1, name: 'Barbell Row', muscleGroup: 'back', type: 'weightReps', alreadyExists: false },
            { wgerId: 2, name: 'Pull Up', muscleGroup: 'back', type: 'bodyweightReps', alreadyExists: false },
        ];

        const count = await importExercises(previews);
        expect(count).toBe(2);

        const inDb = await db.exercises.where('id').anyOf(['wger_1', 'wger_2']).toArray();
        expect(inDb).toHaveLength(2);
        expect(inDb[0].isCustom).toBe(false);
    });

    it('does not import duplicates by id', async () => {
        const previews: ImportPreview[] = [
            { wgerId: 10, name: 'Deadlift', muscleGroup: 'back', type: 'weightReps', alreadyExists: false },
        ];

        await importExercises(previews);
        const count = await importExercises(previews);
        expect(count).toBe(0);

        const inDb = await db.exercises.where('id').equals('wger_10').toArray();
        expect(inDb).toHaveLength(1);
    });

    it('returns correct import count', async () => {
        const previews: ImportPreview[] = [
            { wgerId: 20, name: 'Overhead Press', muscleGroup: 'shoulders', type: 'weightReps', alreadyExists: false },
            { wgerId: 21, name: 'Lateral Raise', muscleGroup: 'shoulders', type: 'weightReps', alreadyExists: false },
            { wgerId: 22, name: 'Face Pull', muscleGroup: 'shoulders', type: 'weightReps', alreadyExists: false },
        ];

        const count = await importExercises(previews);
        expect(count).toBe(3);
    });
});

describe('fetchImportPreview (mocked)', () => {
    beforeEach(async () => {
        await db.exercises.clear();
    });

    it('filters out already existing exercises by name', async () => {
        await db.exercises.add({
            id: 'existing_1',
            name: 'Bench Press',
            type: 'weightReps',
            muscleGroup: 'chest',
            isCustom: false,
        });

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                count: 2,
                next: null,
                results: [
                    { id: 100, name: 'Bench Press', category: { id: 11, name: 'Chest' }, muscles: [], muscles_secondary: [], equipment: [{ id: 3, name: 'Barbell' }], description: '' },
                    { id: 101, name: 'Incline Press', category: { id: 11, name: 'Chest' }, muscles: [], muscles_secondary: [], equipment: [{ id: 3, name: 'Barbell' }], description: '' },
                ],
            }),
        });

        const { fetchImportPreview } = await import('../lib/services/exerciseImport');
        const previews = await fetchImportPreview(10);

        expect(previews.find((p) => p.name === 'Bench Press')).toBeUndefined();
        expect(previews.find((p) => p.name === 'Incline Press')).toBeDefined();
    });
});
