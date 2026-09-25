import { expect, it } from 'vitest';
import { readAppTokenFields } from './config';
const token = {
  memberId: 'synthetic',
  memberName: 'synthetic',
  role: 'ADMIN',
  scope: 'FAMILY',
  entrypoint: 'WEB',
};
it('requires an explicit safe WEB session version; old cookies fail closed', () => {
  for (const sessionVersion of [undefined, -1, 1.5, '0', NaN])
    expect(readAppTokenFields({ ...token, sessionVersion })).toBeNull();
  expect(readAppTokenFields({ ...token, sessionVersion: 0 })?.sessionVersion).toBe(0);
});
it('DEVICE cookies stay SELF without requiring a WEB session version', () => {
  expect(readAppTokenFields({ ...token, entrypoint: 'DEVICE', deviceId: 'synthetic' })).toBeNull();
  expect(
    readAppTokenFields({ ...token, scope: 'SELF', entrypoint: 'DEVICE', deviceId: 'synthetic' }),
  ).toMatchObject({ scope: 'SELF', entrypoint: 'DEVICE' });
});
