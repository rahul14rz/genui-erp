import 'dart:math';

import 'package:http/http.dart' as http;

// genui_a2a's public library exports A2AClient but not the SSE transport or
// message types, and the default transport cannot carry a bearer token.
// ignore: implementation_imports
import 'package:genui_a2a/src/a2a/a2a.dart' as a2a;

const a2uiExtension = 'https://a2ui.org/a2a-extension/a2ui/v0.9';

/// One thing the server sent during a turn.
sealed class AgentEvent {
  const AgentEvent();
}

final class StatusLine extends AgentEvent {
  const StatusLine(this.text);
  final String text;
}

final class PendingShapes extends AgentEvent {
  const PendingShapes(this.surfaceId, this.components);
  final String surfaceId;
  final List<String> components;
}

final class UiMessage extends AgentEvent {
  const UiMessage(this.json);
  final Map<String, Object?> json;
}

final class AnswerText extends AgentEvent {
  const AnswerText(this.text);
  final String text;
}

final class TurnEnded extends AgentEvent {
  const TurnEnded({required this.failed});
  final bool failed;
}

String _id() {
  final r = Random.secure();
  return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

/// Speaks A2A to the server over SSE, keeping the conversation's context id.
class ErpConnection {
  ErpConnection({required String apiUrl, required String token, http.Client? httpClient})
      : _client = a2a.A2AClient(
          url: '$apiUrl/a2a',
          transport: a2a.SseTransport(
            url: '$apiUrl/a2a',
            client: httpClient,
            authHeaders: {'Authorization': 'Bearer $token', 'X-A2A-Extensions': a2uiExtension},
          ),
        );

  final a2a.A2AClient _client;
  String? contextId;

  Stream<AgentEvent> ask(String question) => _send([a2a.Part.text(text: question)]);

  Stream<AgentEvent> sendInteraction(Map<String, Object?> interaction) => _send([a2a.Part.data(data: interaction)]);

  Stream<AgentEvent> _send(List<a2a.Part> parts) async* {
    final message = a2a.Message(
      messageId: _id(),
      role: a2a.Role.user,
      parts: parts,
      contextId: contextId,
      extensions: const [a2uiExtension],
    );
    var ended = false;
    try {
      await for (final event in _client.messageStream(message)) {
        if (event is! a2a.StatusUpdate) continue;
        contextId = event.contextId;
        for (final part in event.status.message?.parts ?? const <a2a.Part>[]) {
          switch (part) {
            case a2a.TextPart(:final text) when text.trim().isNotEmpty:
              yield AnswerText(text.trim());
            case a2a.DataPart(:final data):
              if (data['erpStatus'] case final String s) {
                yield StatusLine(s);
              } else if (data['erpPending'] case {'surfaceId': final String id, 'components': final List<Object?> c}) {
                yield PendingShapes(id, c.cast<String>());
              } else {
                yield UiMessage(Map<String, Object?>.from(data));
              }
            default:
          }
        }
        if (event.final_) {
          ended = true;
          yield TurnEnded(failed: event.status.state == a2a.TaskState.failed);
        }
      }
    } on Object {
      ended = true;
      yield const AnswerText('The connection to the server dropped. Nothing was changed. Check that the server is running, then ask again.');
      yield const TurnEnded(failed: true);
    }
    if (!ended) yield const TurnEnded(failed: false);
  }
}
