import 'dart:async';
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:genui/genui.dart';

import '../auth/auth.dart';
import '../catalog/erp_catalog.dart';
import '../config.dart';
import 'connection.dart';

/// One question and everything the server sent back for it.
final class Turn {
  const Turn({
    required this.id,
    required this.question,
    this.status,
    this.pending = const [],
    this.surfaces = const [],
    this.notes = const [],
    this.done = false,
    this.failed = false,
  });

  final int id;
  final String question;
  final String? status;
  final List<String> pending;
  final List<String> surfaces;
  final List<String> notes;
  final bool done;
  final bool failed;

  Turn copyWith({
    String? Function()? status,
    List<String>? pending,
    List<String>? surfaces,
    List<String>? notes,
    bool? done,
    bool? failed,
  }) =>
      Turn(
        id: id,
        question: question,
        status: status == null ? this.status : status(),
        pending: pending ?? this.pending,
        surfaces: surfaces ?? this.surfaces,
        notes: notes ?? this.notes,
        done: done ?? this.done,
        failed: failed ?? this.failed,
      );
}

final class ConversationState {
  const ConversationState({this.turns = const [], this.busy = false});
  final List<Turn> turns;
  final bool busy;
}

class ConversationController extends Notifier<ConversationState> {
  late SurfaceController surfaces;
  ErpConnection? _connection;
  Future<void> _queue = Future.value();
  int _seq = 0;

  @override
  ConversationState build() {
    final session = ref.watch(authProvider.select((a) => a.session));
    surfaces = SurfaceController(catalogs: [buildErpCatalog()]);
    final sub = surfaces.onSubmit.listen(_onInteraction);
    ref.onDispose(() {
      sub.cancel();
      surfaces.dispose();
    });
    _connection = session == null ? null : ErpConnection(apiUrl: apiUrl, token: session.token);
    return const ConversationState();
  }

  void ask(String question) {
    final q = question.trim();
    if (q.isEmpty || _connection == null) return;
    final turn = Turn(id: ++_seq, question: q, status: 'Sending');
    state = ConversationState(turns: [...state.turns, turn], busy: true);
    _enqueue(() => _consume(turn.id, _connection!.ask(q)));
  }

  /// UI events from generated surfaces go back to the server, attached to the
  /// turn that owns the surface.
  void _onInteraction(ChatMessage message) {
    for (final part in message.parts) {
      if (!part.isUiInteractionPart) continue;
      final json = jsonDecode(part.asUiInteractionPart!.interaction);
      if (json is! Map<String, Object?>) continue;
      final surfaceId = (json['action'] as Map?)?['surfaceId'];
      final owner = state.turns.lastWhere((t) => t.surfaces.contains(surfaceId), orElse: () => state.turns.last);
      _update(owner.id, (t) => t.copyWith(done: false, status: () => 'Sending'));
      state = ConversationState(turns: state.turns, busy: true);
      _enqueue(() => _consume(owner.id, _connection!.sendInteraction(json)));
    }
  }

  void _enqueue(Future<void> Function() job) => _queue = _queue.then((_) => job());

  void _update(int id, Turn Function(Turn) f) {
    state = ConversationState(turns: [for (final t in state.turns) t.id == id ? f(t) : t], busy: state.busy);
  }

  Future<void> _consume(int turnId, Stream<AgentEvent> events) async {
    await for (final e in events) {
      switch (e) {
        case StatusLine(:final text):
          _update(turnId, (t) => t.copyWith(status: () => text));
        case PendingShapes(:final components):
          _update(turnId, (t) => t.copyWith(pending: components));
        case UiMessage(:final json):
          if (json['createSurface'] case {'surfaceId': final String id}) {
            _update(turnId, (t) => t.copyWith(surfaces: [...t.surfaces, id], pending: const []));
          } else if (json['deleteSurface'] case {'surfaceId': final String id}) {
            _update(turnId, (t) => t.copyWith(surfaces: [for (final s in t.surfaces) if (s != id) s]));
          }
          surfaces.handleMessage(core.A2uiMessage.fromJson(json));
        case AnswerText(:final text):
          _update(turnId, (t) => t.copyWith(notes: [...t.notes, text]));
        case TurnEnded(:final failed):
          _update(turnId, (t) => t.copyWith(done: true, failed: failed, status: () => null, pending: const []));
      }
    }
    state = ConversationState(turns: state.turns, busy: false);
  }
}

final conversationProvider = NotifierProvider<ConversationController, ConversationState>(ConversationController.new);
