import type { MessageProposal } from '@swapcircle/contracts';
import { randomUUID } from 'node:crypto';
import { test, expect, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { ConversationsService } from '../src/features/conversations/conversations.service.js';
import type { ConversationsRepository } from '../src/features/conversations/conversations.repository.js';
import type { SafetyPermissions } from '../src/features/safety/safety.permissions.js';

const actor = randomUUID();
const owner = randomUUID();
const conversationId = randomUUID();
const messageId = randomUUID();

function fixture() {
  let saved:
    | {
        id: string;
        conversation_id: string;
        body: string;
        has_photo: boolean;
        proposal?: MessageProposal;
      }
    | undefined;
  let photo: { photo_base64: string; source_digest: string } | undefined;
  const repository = {
    transaction: async <T>(work: (client: never) => Promise<T>) =>
      work({} as never),
    proposalListing: vi.fn(async () => ({
      owner_id: owner,
      title: 'Bicycle',
      availability: 'available',
    })),
    memberExists: vi.fn(async () => true),
    findDirect: vi.fn(async () => ({ id: conversationId, active: true })),
    identity: vi.fn(async () => ({
      type: 'direct',
      direct_user_low: actor,
      direct_user_high: owner,
    })),
    activeMembers: vi.fn(async () => [actor, owner]),
    retryMessage: vi.fn(async () => saved),
    insertMessage: vi.fn(async (_client, _actor, input, image, proposal) => {
      saved = {
        id: messageId,
        conversation_id: input.conversation_id,
        body: input.body,
        has_photo: !!image,
        proposal,
      };
      if (image)
        photo = {
          photo_base64: image.photoBase64,
          source_digest: image.sourceDigest,
        };
      return saved;
    }),
    photo: vi.fn(async () => photo),
    messageConversation: vi.fn(async () => conversationId),
    lockReader: vi.fn(async () => true),
  };
  const permissions = {
    assertContactAllowed: vi.fn(async () => {}),
    lockPair: vi.fn(async () => {}),
    assertUnrestricted: vi.fn(async () => {}),
    consume: vi.fn(async () => {}),
  };
  const service = new ConversationsService(
    repository as unknown as ConversationsRepository,
    permissions as unknown as SafetyPermissions,
  );
  const app = createApp({
    allowedOrigins: [],
    verifyToken: async () => actor,
    conversations: service,
  });
  return { service, app, repository, permissions };
}

const input = () => ({
  listingId: randomUUID(),
  body: 'I can offer a lamp.',
  clientMessageId: randomUUID(),
});
const image = async (color: string) =>
  (
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: color },
    })
      .png()
      .toBuffer()
  ).toString('base64');

test('proposal endpoint authenticates before parsing uploads and rejects forged or invalid fields', async () => {
  const { app, repository } = fixture();
  const path = '/api/v1/conversations/proposals';
  await request(app).post(path).send(input()).expect(401);
  for (const invalid of [
    { ...input(), senderId: actor },
    { ...input(), body: '  ' },
    { ...input(), photoBase64: 'invalid!' },
    { ...input(), listingId: 'invalid' },
  ]) {
    await request(app)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .send(invalid)
      .expect(400);
  }
  expect(repository.insertMessage).not.toHaveBeenCalled();
});

test('optional image is processed to WebP and saved with the message; identical retries reuse it', async () => {
  const { service, repository } = fixture();
  const payload = { ...input(), photoBase64: await image('red') };
  await service.sendProposal(actor, payload);
  const receipt = await service.sendProposal(actor, payload);
  expect(repository.insertMessage).toHaveBeenCalledTimes(1);
  expect(receipt.has_photo).toBe(true);
  const result = await service.readPhoto(owner, messageId);
  const metadata = await sharp(
    Buffer.from(result.dataUrl.split(',')[1]!, 'base64'),
  ).metadata();
  expect(metadata.format).toBe('webp');
  expect(metadata.exif).toBeUndefined();
  await expect(
    service.sendProposal(actor, {
      ...payload,
      photoBase64: await image('blue'),
    }),
  ).rejects.toMatchObject({ code: 'MESSAGE_RETRY_CONFLICT' });
  await expect(
    service.sendProposal(actor, { ...payload, photoBase64: undefined }),
  ).rejects.toMatchObject({ code: 'MESSAGE_RETRY_CONFLICT' });
});

test('blocked send, invalid image and inactive photo readers cannot access or persist content', async () => {
  const { service, repository, permissions } = fixture();
  permissions.assertContactAllowed.mockRejectedValueOnce(new Error('blocked'));
  await expect(service.sendProposal(actor, input())).rejects.toThrow('blocked');
  await expect(
    service.sendProposal(actor, {
      ...input(),
      photoBase64: Buffer.from('not an image').toString('base64'),
    }),
  ).rejects.toMatchObject({ code: 'INVALID_PHOTO' });
  expect(repository.insertMessage).not.toHaveBeenCalled();
  repository.lockReader.mockResolvedValueOnce(false);
  await expect(service.readPhoto(actor, messageId)).rejects.toMatchObject({
    status: 403,
  });
  expect(repository.photo).not.toHaveBeenCalled();
});

test('unavailable listings and self proposals are rejected without a message', async () => {
  const { service, repository } = fixture();
  repository.proposalListing.mockResolvedValueOnce({
    owner_id: actor,
    title: 'Lamp',
    availability: 'available',
  });
  await expect(service.sendProposal(actor, input())).rejects.toMatchObject({
    status: 409,
  });
  repository.proposalListing.mockResolvedValueOnce({
    owner_id: owner,
    title: 'Lamp',
    availability: 'reserved',
  });
  await expect(service.sendProposal(actor, input())).rejects.toMatchObject({
    status: 409,
  });
  expect(repository.insertMessage).not.toHaveBeenCalled();
});

test('offered item quality is included in the saved message and bound to retries', async () => {
  const { service, app } = fixture();
  const payload = { ...input(), condition: 'good' as const };
  const receipt = await service.sendProposal(actor, payload);
  expect(receipt.body).toBe(
    'About “Bicycle”\n\nOffered item quality: Good\n\nI can offer a lamp.',
  );
  await expect(
    service.sendProposal(actor, { ...payload, condition: 'fair' }),
  ).rejects.toMatchObject({ code: 'MESSAGE_RETRY_CONFLICT' });
  await request(app)
    .post('/api/v1/conversations/proposals')
    .set('Authorization', 'Bearer synthetic')
    .send({ ...input(), condition: 'unknown' })
    .expect(400);
  const { service: poorService } = fixture();
  const poor = await poorService.sendProposal(actor, {
    ...input(),
    condition: 'poor',
  });
  expect(poor.body).toContain('Offered item quality: Poor');
});

test('proposal snapshots are saved with the message and cannot be forged through ordinary sends', async () => {
  const { service, app } = fixture();
  const payload = { ...input(), condition: 'fair' as const };
  const receipt = await service.sendProposal(actor, payload);
  expect(receipt.proposal).toEqual({
    listingId: payload.listingId,
    listingTitle: 'Bicycle',
    message: payload.body,
    condition: 'fair',
  });
  await expect(
    service.sendProposal(actor, { ...payload, listingId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'MESSAGE_RETRY_CONFLICT' });
  await request(app)
    .post('/api/v1/conversations/messages')
    .set('Authorization', 'Bearer synthetic')
    .send({
      conversation_id: conversationId,
      body: 'Ordinary message',
      client_message_id: randomUUID(),
      proposal: receipt.proposal,
    })
    .expect(400);
});

test('shelf proposals validate current ownership and availability and snapshot the offered item', async () => {
  const { service, repository, app } = fixture();
  const offeredListingId = randomUUID();
  const offered = {
    owner_id: actor,
    title: 'Desk lamp',
    availability: 'available',
  };
  repository.proposalListing.mockResolvedValueOnce({
    owner_id: owner,
    title: 'Bicycle',
    availability: 'available',
  });
  repository.proposalListing.mockResolvedValueOnce(offered);
  Object.assign(repository, { proposalTarget: vi.fn(async () => offered) });
  const saved = await service.sendProposal(actor, {
    ...input(),
    offeredListingId,
  });
  expect(saved.proposal?.offeredListing).toEqual({
    id: offeredListingId,
    title: 'Desk lamp',
  });
  expect(saved.proposal?.message).toBe('I can offer a lamp.');

  for (const invalid of [
    { ...offered, owner_id: owner },
    { ...offered, availability: 'reserved' },
  ]) {
    const next = fixture();
    next.repository.proposalListing.mockResolvedValueOnce({
      owner_id: owner,
      title: 'Bicycle',
      availability: 'available',
    });
    next.repository.proposalListing.mockResolvedValueOnce(invalid);
    await expect(
      next.service.sendProposal(actor, { ...input(), offeredListingId }),
    ).rejects.toMatchObject({ code: 'OFFERED_ITEM_UNAVAILABLE' });
    expect(next.repository.insertMessage).not.toHaveBeenCalled();
  }
  await request(app)
    .post('/api/v1/conversations/proposals')
    .set('Authorization', 'Bearer synthetic')
    .send({ ...input(), offeredListingId, photoBase64: 'AAAA' })
    .expect(400);
});

test('a shelf item that becomes unavailable before insertion prevents the proposal write', async () => {
  const { service, repository } = fixture();
  repository.proposalListing.mockResolvedValueOnce({
    owner_id: owner,
    title: 'Bicycle',
    availability: 'available',
  });
  repository.proposalListing.mockResolvedValueOnce({
    owner_id: actor,
    title: 'Desk lamp',
    availability: 'available',
  });
  Object.assign(repository, {
    proposalTarget: vi.fn(async () => ({
      owner_id: actor,
      title: 'Desk lamp',
      availability: 'reserved',
    })),
  });
  await expect(
    service.sendProposal(actor, { ...input(), offeredListingId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'OFFERED_ITEM_UNAVAILABLE' });
  expect(repository.insertMessage).not.toHaveBeenCalled();
});
