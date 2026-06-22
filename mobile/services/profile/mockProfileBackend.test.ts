import { mockProfileBackend } from './mockProfileBackend';

it('save merges and get returns the merged profile', async () => {
  await mockProfileBackend.save({ fullName: 'Ana' });
  await mockProfileBackend.save({ city: 'São Paulo' });
  expect(await mockProfileBackend.get()).toMatchObject({ fullName: 'Ana', city: 'São Paulo' });
});
