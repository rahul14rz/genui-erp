import 'package:erp_design/erp_design.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:genui/genui.dart' show SurfaceController;

import '../agent/conversation.dart';
import '../auth/auth.dart';
import '../catalog/erp_scope.dart';
import '../conversation/ask_box.dart';
import '../conversation/suggestions.dart';
import '../conversation/turn_view.dart';
import 'record_panel.dart';
import 'theme_mode.dart';

enum _Layout { phone, tablet, desktop }

/// Desktop: collapsible nav, an 880px conversation column, optional record
/// panel. Tablet: the nav becomes a rail. Phone: full-width surfaces with the
/// ask box pinned to the bottom.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _askFocus = FocusNode(debugLabel: 'ask box');
  final _scroll = ScrollController();
  final _turnKeys = <int, GlobalKey>{};
  bool _navOpen = true;
  Map<String, Object?>? _openRow;

  @override
  void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(_onKey);
  }

  /// Handled here rather than with Shortcuts so they work wherever focus is,
  /// including after a click on empty space.
  bool _onKey(KeyEvent e) {
    if (e is! KeyDownEvent) return false;
    final k = HardwareKeyboard.instance;
    if (e.logicalKey == LogicalKeyboardKey.keyK && (k.isMetaPressed || k.isControlPressed)) {
      _askFocus.requestFocus();
      return true;
    }
    if (e.logicalKey == LogicalKeyboardKey.escape && _openRow != null && ModalRoute.of(context)?.isCurrent == true) {
      setState(() => _openRow = null);
      return true;
    }
    return false;
  }

  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_onKey);
    _askFocus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _ask(String q) {
    ref.read(conversationProvider.notifier).ask(q);
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToEnd());
  }

  void _scrollToEnd() {
    if (!_scroll.hasClients) return;
    final duration = Motion.of(context);
    final target = _scroll.position.maxScrollExtent;
    if (duration == Duration.zero) {
      _scroll.jumpTo(target);
    } else {
      _scroll.animateTo(target, duration: duration, curve: Motion.curve);
    }
  }

  void _jumpTo(int turnId) {
    final ctx = _turnKeys[turnId]?.currentContext;
    if (ctx != null) Scrollable.ensureVisible(ctx, duration: Motion.of(context), curve: Motion.curve);
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(authProvider).session!;
    final convo = ref.watch(conversationProvider);
    final controller = ref.read(conversationProvider.notifier).surfaces;
    ref.listen(conversationProvider, (prev, next) {
      if (prev?.turns.length != next.turns.length ||
          prev?.turns.lastOrNull?.surfaces.length != next.turns.lastOrNull?.surfaces.length) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToEnd());
      }
    });

    final width = MediaQuery.sizeOf(context).width;
    final layout = width < Breakpoints.phone
        ? _Layout.phone
        : width < Breakpoints.desktop
        ? _Layout.tablet
        : _Layout.desktop;

    final c = context.colors;
    final conversation = _Conversation(
      session: session,
      state: convo,
      controller: controller,
      scroll: _scroll,
      turnKeys: _turnKeys,
      onAsk: _ask,
      dense: layout == _Layout.phone,
    );
    final askBox = Container(
      decoration: BoxDecoration(
        color: c.bg,
        border: Border(top: BorderSide(color: c.border)),
      ),
      padding: const EdgeInsets.all(Space.x3),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: Breakpoints.column),
          child: AskBox(onAsk: _ask, focusNode: _askFocus, busy: convo.busy, autofocus: layout != _Layout.phone),
        ),
      ),
    );

    final main = Column(
      children: [
        if (layout == _Layout.phone) _PhoneBar(session: session),
        Expanded(child: conversation),
        askBox,
      ],
    );

    final panel = _openRow == null
        ? null
        : RecordPanel(row: _openRow!, onClose: () => setState(() => _openRow = null), onAsk: _ask);

    Widget body;
    switch (layout) {
      case _Layout.phone:
        body = Stack(
          children: [
            main,
            if (panel != null) Positioned.fill(child: panel),
          ],
        );
      case _Layout.tablet:
        body = Row(
          children: [
            _Rail(session: session),
            Expanded(child: main),
            if (panel != null) SizedBox(width: 320, child: panel),
          ],
        );
      case _Layout.desktop:
        body = Row(
          children: [
            AnimatedContainer(
              duration: Motion.of(context),
              curve: Motion.curve,
              width: _navOpen ? 260 : 64,
              child: _navOpen
                  ? _Nav(
                      session: session,
                      turns: convo.turns,
                      onCollapse: () => setState(() => _navOpen = false),
                      onJump: _jumpTo,
                    )
                  : _Rail(session: session, onExpand: () => setState(() => _navOpen = true)),
            ),
            Expanded(child: main),
            if (panel != null) SizedBox(width: 360, child: panel),
          ],
        );
    }

    return ErpScope(
      ask: _ask,
      openRow: (row) => setState(() => _openRow = row),
      child: Scaffold(body: SafeArea(child: body)),
    );
  }
}

class _Conversation extends StatelessWidget {
  const _Conversation({
    required this.session,
    required this.state,
    required this.controller,
    required this.scroll,
    required this.turnKeys,
    required this.onAsk,
    required this.dense,
  });

  final AuthSession session;
  final ConversationState state;
  final SurfaceController controller;
  final ScrollController scroll;
  final Map<int, GlobalKey> turnKeys;
  final ValueChanged<String> onAsk;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    final pad = dense ? Space.x3 : Space.x6;
    if (state.turns.isEmpty) {
      return Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(pad),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: Breakpoints.column),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Ask about ${session.tenantName}', style: dense ? t.title : t.display),
                const SizedBox(height: Space.x2),
                Text(
                  'Answers come back as tables, charts and forms built from live data. '
                  'You see what the ${session.roleLabel} role can see, nothing more.',
                  style: t.bodySecondary,
                ),
                const SizedBox(height: Space.x6),
                Wrap(
                  spacing: Space.x2,
                  runSpacing: Space.x2,
                  children: [
                    for (final q in suggestionsByRole[session.role] ?? const <String>[])
                      FollowUpChip(q, onTap: () => onAsk(q)),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
    }
    return ListView.builder(
      controller: scroll,
      padding: EdgeInsets.symmetric(vertical: pad),
      itemCount: state.turns.length,
      itemBuilder: (context, i) {
        final turn = state.turns[i];
        return Center(
          key: turnKeys.putIfAbsent(turn.id, GlobalKey.new),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: Breakpoints.column + 2 * Space.x6),
            child: Padding(
              padding: EdgeInsets.fromLTRB(pad, 0, pad, Space.x8),
              child: TurnView(turn: turn, controller: controller),
            ),
          ),
        );
      },
    );
  }
}

class _Nav extends ConsumerWidget {
  const _Nav({required this.session, required this.turns, required this.onCollapse, required this.onJump});

  final AuthSession session;
  final List<Turn> turns;
  final VoidCallback onCollapse;
  final ValueChanged<int> onJump;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = context.type;
    final c = context.colors;
    return Container(
      decoration: BoxDecoration(
        color: c.surfaceSunken,
        border: Border(right: BorderSide(color: c.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.x4, Space.x4, Space.x2, Space.x2),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('genui-erp', style: t.heading),
                      Text(session.tenantName, style: t.caption.copyWith(color: c.textSecondary)),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Collapse navigation',
                  icon: Icon(Icons.keyboard_double_arrow_left, size: 18, color: c.textSecondary),
                  onPressed: onCollapse,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.x4, Space.x4, Space.x4, Space.x2),
            child: Text('This session', style: t.caption.copyWith(color: c.textSecondary)),
          ),
          Expanded(
            child: turns.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(horizontal: Space.x4),
                    child: Text('Questions you ask appear here.', style: t.caption),
                  )
                : ListView(
                    padding: const EdgeInsets.symmetric(horizontal: Space.x2),
                    children: [for (final turn in turns) _NavItem(label: turn.question, onTap: () => onJump(turn.id))],
                  ),
          ),
          Divider(height: 1, color: c.border),
          _Account(session: session),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: Radii.control,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: Space.x2, vertical: Space.x2),
      child: Text(label, style: context.type.body, maxLines: 1, overflow: TextOverflow.ellipsis),
    ),
  );
}

class _AccountActions extends ConsumerWidget {
  const _AccountActions({this.vertical = false});
  final bool vertical;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final brightness = Theme.of(context).brightness;
    final buttons = [
      IconButton(
        tooltip: brightness == Brightness.dark ? 'Use light theme' : 'Use dark theme',
        icon: Icon(
          brightness == Brightness.dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
          size: 18,
          color: c.textSecondary,
        ),
        onPressed: () => ref.read(themeModeProvider.notifier).toggle(brightness),
      ),
      if (!kReleaseMode)
        IconButton(
          tooltip: 'Catalog gallery',
          icon: Icon(Icons.dashboard_outlined, size: 18, color: c.textSecondary),
          onPressed: () => Navigator.of(context).pushNamed('/gallery'),
        ),
      IconButton(
        tooltip: 'Sign out',
        icon: Icon(Icons.logout, size: 18, color: c.textSecondary),
        onPressed: () => ref.read(authProvider.notifier).signOut(),
      ),
    ];
    return vertical
        ? Column(mainAxisSize: MainAxisSize.min, children: buttons)
        : Row(mainAxisSize: MainAxisSize.min, children: buttons);
  }
}

class _Account extends StatelessWidget {
  const _Account({required this.session});
  final AuthSession session;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    return Padding(
      padding: const EdgeInsets.all(Space.x3),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(session.userName, style: t.bodyStrong, overflow: TextOverflow.ellipsis),
                Text(session.roleLabel, style: t.caption.copyWith(color: context.colors.textSecondary)),
              ],
            ),
          ),
          const _AccountActions(),
        ],
      ),
    );
  }
}

class _Rail extends StatelessWidget {
  const _Rail({required this.session, this.onExpand});
  final AuthSession session;
  final VoidCallback? onExpand;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      width: 64,
      decoration: BoxDecoration(
        color: c.surfaceSunken,
        border: Border(right: BorderSide(color: c.border)),
      ),
      child: Column(
        children: [
          const SizedBox(height: Space.x3),
          Tooltip(
            message: '${session.tenantName}, ${session.roleLabel}',
            child: CircleAvatar(
              radius: 16,
              backgroundColor: c.accentSubtle,
              child: Text(session.userName.characters.first, style: context.type.bodyStrong.copyWith(color: c.accent)),
            ),
          ),
          if (onExpand != null)
            IconButton(
              tooltip: 'Expand navigation',
              icon: Icon(Icons.keyboard_double_arrow_right, size: 18, color: c.textSecondary),
              onPressed: onExpand,
            ),
          const Spacer(),
          const _AccountActions(vertical: true),
          const SizedBox(height: Space.x2),
        ],
      ),
    );
  }
}

class _PhoneBar extends StatelessWidget {
  const _PhoneBar({required this.session});
  final AuthSession session;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.fromLTRB(Space.x3, Space.x2, Space.x1, Space.x2),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(session.tenantName, style: context.type.bodyStrong),
                Text('${session.userName}, ${session.roleLabel}', style: context.type.caption),
              ],
            ),
          ),
          const _AccountActions(),
        ],
      ),
    );
  }
}
