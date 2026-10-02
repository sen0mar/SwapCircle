import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import type {
  MeetingCreate,
  MeetingUpdate,
  MeetingResponse,
} from '@swapcircle/contracts';
import {
  SafetyError,
  SafetyPermissions,
} from '../safety/safety.permissions.js';
import { lockProposalBoundary } from '../trades/proposal-boundary.js';
import { createNotification } from '../notifications/notifications.repository.js';
import type { MeetingsRepository } from './meetings.repository.js';

export class MeetingsService {
  constructor(
    private readonly repository: MeetingsRepository,
    private readonly permissions = new SafetyPermissions(),
  ) {}

  private unavailable(): never {
    throw new SafetyError(
      404,
      'MEETING_UNAVAILABLE',
      'This meeting is unavailable.',
    );
  }

  private conflict(): never {
    throw new SafetyError(
      409,
      'MEETING_CONFLICT',
      'The arrangement or response changed. Reload the meeting.',
    );
  }

  private async authorize(client: PoolClient, actor: string, tradeId: string) {
    await this.permissions.assertUnrestricted(client, [actor]);
    const trade = await this.repository.trades.lockTrade(
      client,
      tradeId,
      actor,
    );
    if (!trade) this.unavailable();
    return trade;
  }

  async read(actor: string, id: string, byTrade = false) {
    return this.repository.trades.transaction(async (client) => {
      await lockProposalBoundary(client);
      const meeting = await this.repository.find(client, id, byTrade);
      if (!meeting) {
        if (byTrade) {
          await this.authorize(client, actor, id);
          return null;
        }
        this.unavailable();
      }
      const trade = await this.authorize(client, actor, meeting.trade_id);
      return this.repository.read(client, meeting.id, trade.current_version);
    });
  }

  async write(
    actor: string,
    tradeId: string,
    input: MeetingCreate | MeetingUpdate | MeetingResponse,
    kind: 'create' | 'update' | 'respond',
  ) {
    return this.repository.trades.transaction(async (client) => {
      await lockProposalBoundary(client);
      await this.repository.trades.lockOperation(
        client,
        actor,
        input.operationKey,
      );
      const trade = await this.authorize(client, actor, tradeId);
      const meeting = await this.repository.find(client, tradeId, true);
      const fingerprint = { kind, tradeId, input };
      const previous = await this.repository.operation(
        client,
        actor,
        input.operationKey,
      );
      if (previous) {
        if (!isDeepStrictEqual(previous.request, fingerprint))
          throw new SafetyError(
            409,
            'OPERATION_CONFLICT',
            'This operation key was used for another meeting action.',
          );
        // A retry acknowledges the saved action and returns current authorized state.
        // It never reapplies an old arrangement or response after a newer revision.
        return this.repository.read(
          client,
          previous.meetup_id,
          trade.current_version,
        );
      }
      if (input.expectedTradeVersion !== trade.current_version) this.conflict();
      if (
        !['proposed', 'confirmed'].includes(trade.status) ||
        (trade.status === 'proposed' &&
          trade.expires_at.getTime() <= Date.now())
      )
        throw new SafetyError(
          409,
          'TRADE_UNAVAILABLE',
          'This trade is unavailable for meeting changes.',
        );

      const current = meeting
        ? await this.repository.read(client, meeting.id, trade.current_version)
        : null;
      if (kind === 'create' ? Boolean(current) : !current) this.conflict();
      if (
        'expectedRevision' in input &&
        input.expectedRevision !== current?.revision
      )
        this.conflict();

      await this.permissions.authorizeWrite(client, actor, 'meeting');
      let id: string;
      let changed: boolean;
      if (kind === 'respond') {
        const response = input as MeetingResponse;
        const saved = current!.responses.find(
          (entry) => entry.userId === actor,
        )!.response;
        if (saved !== response.expectedResponse) this.conflict();
        changed = saved !== response.response;
        id = current!.id;
        if (changed)
          await this.repository.respond(
            client,
            id,
            actor,
            current!.revision,
            trade.current_version,
            response.response,
          );
      } else {
        const arrangement = input as MeetingCreate;
        changed =
          !current ||
          ['place', 'mapLink', 'meetingAt', 'timeZone'].some(
            (field) =>
              current[field as keyof typeof current] !==
              arrangement[field as keyof MeetingCreate],
          );
        id = changed
          ? await this.repository.arrange(
              client,
              tradeId,
              arrangement,
              current?.id,
            )
          : current!.id;
      }
      await this.repository.saveOperation(
        client,
        actor,
        input.operationKey,
        id,
        fingerprint,
      );
      if (changed) {
        const event = randomUUID();
        for (const recipient of await this.repository.trades.participantIds(
          client,
          tradeId,
        )) {
          if (recipient === actor) continue;
          await createNotification(client, {
            recipient_id: recipient,
            domain_event_id: event,
            event_type: 'meeting_change',
            resource_type: 'meetup',
            resource_id: id,
          });
        }
      }
      return this.repository.read(client, id, trade.current_version);
    });
  }
}
