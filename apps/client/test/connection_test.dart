import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:genui_erp_client/agent/connection.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String frame(Map<String, Object?> result) => 'data: ${jsonEncode({'jsonrpc': '2.0', 'id': 1, 'result': result})}\n\n';

Map<String, Object?> update(List<Map<String, Object?>> parts, {String state = 'working', bool last = false}) => {
      'kind': 'status-update',
      'taskId': 't1',
      'contextId': 'ctx-1',
      'final': last,
      'status': {
        'state': state,
        'message': {'kind': 'message', 'role': 'agent', 'messageId': 'm', 'parts': parts},
      },
    };

void main() {
  test('maps server frames to agent events and keeps the context id', () async {
    late http.Request seen;
    final client = MockClient.streaming((request, body) async {
      seen = request as http.Request;
      final sse = [
        frame(update([{'kind': 'data', 'data': {'erpStatus': 'Reading orders'}}])),
        frame(update([{'kind': 'data', 'data': {'erpPending': {'surfaceId': 's1', 'components': ['DataTable']}}}])),
        frame(update([{'kind': 'data', 'data': {'version': 'v0.9', 'createSurface': {'surfaceId': 's1', 'catalogId': 'c'}}}])),
        frame(update([{'kind': 'text', 'text': 'Here are your orders.'}])),
        frame(update([], state: 'completed', last: true)),
      ].join();
      return http.StreamedResponse(Stream.value(utf8.encode(sse)), 200, headers: {'content-type': 'text/event-stream'});
    });
    final conn = ErpConnection(apiUrl: 'http://api.test', token: 'tok', httpClient: client);
    final events = await conn.ask('show orders').toList();

    expect(seen.url.toString(), 'http://api.test/a2a');
    expect(seen.headers['Authorization'], 'Bearer tok');
    expect(seen.headers['X-A2A-Extensions'], a2uiExtension);
    expect((jsonDecode(seen.body) as Map)['method'], 'message/stream');

    expect(events[0], isA<StatusLine>().having((e) => e.text, 'text', 'Reading orders'));
    expect(events[1], isA<PendingShapes>().having((e) => e.components, 'components', ['DataTable']));
    expect(events[2], isA<UiMessage>());
    expect(events[3], isA<AnswerText>().having((e) => e.text, 'text', 'Here are your orders.'));
    expect(events[4], isA<TurnEnded>().having((e) => e.failed, 'failed', false));
    expect(conn.contextId, 'ctx-1');
  });

  test('reports a dropped connection as a failed turn with plain copy', () async {
    final client = MockClient((_) async => http.Response('nope', 500));
    final events = await ErpConnection(apiUrl: 'http://api.test', token: 't', httpClient: client).ask('x').toList();
    expect(events.whereType<AnswerText>().single.text, contains('Nothing was changed'));
    expect(events.last, isA<TurnEnded>().having((e) => e.failed, 'failed', true));
  });
}
