import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../catalog/generated.dart' as g;
import '../format.dart';
import '../theme.dart';
import '../tokens.dart';
import 'primitives.dart';

typedef RowActionCallback = void Function(g.ActionRef action, Map<String, Object?> row);

/// Server-paginated table. On phone widths each row becomes a stacked block.
/// Arrow keys move between rows and Enter opens the focused row.
class DataTableView extends StatefulWidget {
  const DataTableView(
    this.data, {
    super.key,
    this.onSort,
    this.onPage,
    this.onRowAction,
    this.onRowOpen,
    this.allowedActions,
  });

  final g.DataTable data;
  final void Function(String key, g.DataTableSortDirection direction)? onSort;
  final ValueChanged<int>? onPage;
  final RowActionCallback? onRowAction;
  final ValueChanged<Map<String, Object?>>? onRowOpen;

  /// Row actions the user may run. Others are not drawn, even if present.
  final Set<String>? allowedActions;

  @override
  State<DataTableView> createState() => _DataTableViewState();
}

class _DataTableViewState extends State<DataTableView> {
  final _focus = FocusNode(debugLabel: 'data table');
  int? _row;
  int? _hover;

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  List<g.ActionRef> get _actions => [
        for (final a in widget.data.rowActions ?? const <g.ActionRef>[])
          if (widget.allowedActions == null || widget.allowedActions!.contains(a.action)) a,
      ];

  KeyEventResult _onKey(FocusNode node, KeyEvent e) {
    if (e is! KeyDownEvent && e is! KeyRepeatEvent) return KeyEventResult.ignored;
    final n = widget.data.rows.length;
    if (n == 0) return KeyEventResult.ignored;
    if (e.logicalKey == LogicalKeyboardKey.arrowDown) {
      setState(() => _row = ((_row ?? -1) + 1).clamp(0, n - 1));
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.arrowUp) {
      setState(() => _row = ((_row ?? n) - 1).clamp(0, n - 1));
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.enter && _row != null) {
      widget.onRowOpen?.call(widget.data.rows[_row!]);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.data;
    final t = context.type;
    return ErpSurface(
      padding: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (d.title != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.x4, Space.x3, Space.x4, Space.x3),
            child: Text(d.title!, style: t.heading),
          ),
        if (d.rows.isEmpty)
          Padding(
            padding: const EdgeInsets.all(Space.x6),
            child: Text(d.emptyText ?? 'No rows match these filters. Widen the date range or clear a filter.',
                style: t.bodySecondary, textAlign: TextAlign.center),
          )
        else
          Focus(
            focusNode: _focus,
            onKeyEvent: _onKey,
            onFocusChange: (f) => setState(() => _row = f ? (_row ?? 0) : null),
            child: LayoutBuilder(
              builder: (context, box) => box.maxWidth < Breakpoints.phone ? _stacked(context) : _grid(context),
            ),
          ),
        _footer(context),
      ]),
    );
  }

  int _flex(g.CellType type) => switch (type) {
        g.CellType.text => 3,
        g.CellType.status => 2,
        _ => 2,
      };

  Widget _grid(BuildContext context) {
    final d = widget.data;
    final c = context.colors;
    final t = context.type;
    final actions = _actions;
    Widget header(g.DataTableColumn col) {
      final active = d.sort?.key == col.key;
      final dir = d.sort?.direction ?? g.DataTableSortDirection.desc;
      final label = Text(col.label, style: t.bodyStrong.copyWith(color: c.textSecondary), overflow: TextOverflow.ellipsis);
      final align = Fmt.isNumeric(col.type) ? MainAxisAlignment.end : MainAxisAlignment.start;
      final content = Row(mainAxisAlignment: align, children: [
        Flexible(child: label),
        if (active)
          Icon(dir == g.DataTableSortDirection.asc ? Icons.arrow_upward : Icons.arrow_downward, size: 14, color: c.textSecondary),
      ]);
      if (col.sortable != true || widget.onSort == null) return content;
      final next = active && dir == g.DataTableSortDirection.desc ? g.DataTableSortDirection.asc : g.DataTableSortDirection.desc;
      return MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(onTap: () => widget.onSort!(col.key, next), child: Semantics(button: true, child: content)),
      );
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        height: 36,
        padding: const EdgeInsets.symmetric(horizontal: Space.x4),
        decoration: BoxDecoration(color: c.surfaceSunken, border: Border.symmetric(horizontal: BorderSide(color: c.border))),
        child: Row(children: [
          for (final col in d.columns) ...[
            Expanded(flex: _flex(col.type), child: header(col)),
            const SizedBox(width: Space.x3),
          ],
          if (actions.isNotEmpty) SizedBox(width: 140.0 * actions.length),
        ]),
      ),
      for (var i = 0; i < d.rows.length; i++)
        MouseRegion(
          onEnter: (_) => setState(() => _hover = i),
          onExit: (_) => setState(() => _hover = null),
          child: GestureDetector(
            onTap: widget.onRowOpen == null ? null : () => widget.onRowOpen!(d.rows[i]),
            child: Container(
              constraints: const BoxConstraints(minHeight: 40),
              padding: const EdgeInsets.symmetric(horizontal: Space.x4, vertical: Space.x2),
              decoration: BoxDecoration(
                color: _row == i ? c.accentSubtle : (_hover == i ? c.surfaceSunken : null),
                border: Border(
                  bottom: BorderSide(color: c.border),
                  left: BorderSide(color: _row == i ? c.accent : Colors.transparent, width: 2),
                ),
              ),
              child: Row(children: [
                for (final col in d.columns) ...[
                  Expanded(flex: _flex(col.type), child: _Cell(col.type, d.rows[i][col.key])),
                  const SizedBox(width: Space.x3),
                ],
                if (actions.isNotEmpty)
                  SizedBox(
                    width: 140.0 * actions.length,
                    child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                      for (final a in actions)
                        Padding(
                          padding: const EdgeInsets.only(left: Space.x2),
                          child: ErpButton(label: a.label, dense: true, onPressed: () => widget.onRowAction?.call(a, d.rows[i])),
                        ),
                    ]),
                  ),
              ]),
            ),
          ),
        ),
    ]);
  }

  Widget _stacked(BuildContext context) {
    final d = widget.data;
    final c = context.colors;
    final t = context.type;
    final lead = d.columns.first;
    final status = d.columns.where((col) => col.type == g.CellType.status).firstOrNull;
    final rest = d.columns.where((col) => col != lead && col != status).toList();
    final actions = _actions;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < d.rows.length; i++)
        GestureDetector(
          onTap: widget.onRowOpen == null ? null : () => widget.onRowOpen!(d.rows[i]),
          child: Container(
            padding: const EdgeInsets.all(Space.x3),
            decoration: BoxDecoration(
              color: _row == i ? c.accentSubtle : null,
              border: Border(top: BorderSide(color: c.border)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: _Cell(lead.type, d.rows[i][lead.key], strong: true)),
                if (status != null) StatusBadge('${d.rows[i][status.key] ?? ''}'),
              ]),
              const SizedBox(height: Space.x1),
              for (final col in rest)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Row(children: [
                    SizedBox(width: 120, child: Text(col.label, style: t.caption.copyWith(color: c.textSecondary))),
                    Expanded(child: _Cell(col.type, d.rows[i][col.key], alignEnd: false)),
                  ]),
                ),
              if (actions.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: Space.x2),
                  child: Wrap(spacing: Space.x2, children: [
                    for (final a in actions)
                      ErpButton(label: a.label, dense: true, onPressed: () => widget.onRowAction?.call(a, d.rows[i])),
                  ]),
                ),
            ]),
          ),
        ),
    ]);
  }

  Widget _footer(BuildContext context) {
    final d = widget.data;
    final total = d.total ?? d.rows.length;
    final offset = d.offset ?? 0;
    final size = d.pageSize ?? d.rows.length;
    if (d.rows.isEmpty || total <= d.rows.length && offset == 0) return const SizedBox.shrink();
    final c = context.colors;
    final from = offset + 1;
    final to = offset + d.rows.length;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Space.x4, vertical: Space.x2),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: c.border))),
      child: Row(children: [
        Expanded(
          child: Text('${Fmt.grouped(from)}–${Fmt.grouped(to)} of ${Fmt.grouped(total)}',
              style: context.type.caption.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
        ),
        ErpButton(
          label: 'Previous',
          dense: true,
          onPressed: offset > 0 && widget.onPage != null ? () => widget.onPage!((offset - size).clamp(0, total)) : null,
        ),
        const SizedBox(width: Space.x2),
        ErpButton(
          label: 'Next',
          dense: true,
          onPressed: to < total && widget.onPage != null ? () => widget.onPage!(offset + size) : null,
        ),
      ]),
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell(this.type, this.value, {this.strong = false, this.alignEnd = true});

  final g.CellType type;
  final Object? value;
  final bool strong;
  final bool alignEnd;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    if (type == g.CellType.status && value != null) {
      return Align(alignment: Alignment.centerLeft, child: StatusBadge('$value'));
    }
    final text = Fmt.cell(type, value);
    final numeric = Fmt.isNumeric(type);
    final style = switch (type) {
      g.CellType.mono => t.mono,
      g.CellType.money || g.CellType.number || g.CellType.percent => t.numeric,
      g.CellType.date || g.CellType.datetime => t.numeric.copyWith(color: context.colors.textSecondary),
      _ => strong ? t.bodyStrong : t.body,
    };
    return Text(
      text,
      style: strong ? style.copyWith(fontWeight: FontWeight.w500) : style,
      textAlign: numeric && alignEnd ? TextAlign.right : TextAlign.left,
      overflow: TextOverflow.ellipsis,
      maxLines: 2,
    );
  }
}

class DataTableSkeleton extends StatelessWidget {
  const DataTableSkeleton({super.key, this.rows = 6});
  final int rows;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return ErpSurface(
      padding: EdgeInsets.zero,
      child: Column(children: [
        Container(height: 36, color: c.surfaceSunken),
        for (var i = 0; i < rows; i++)
          Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: Space.x4),
            decoration: BoxDecoration(border: Border(top: BorderSide(color: c.border))),
            child: const Row(children: [
              Expanded(flex: 2, child: Align(alignment: Alignment.centerLeft, child: SkeletonBlock(width: 72, height: 12))),
              Expanded(flex: 3, child: Align(alignment: Alignment.centerLeft, child: SkeletonBlock(width: 140, height: 12))),
              Expanded(flex: 2, child: Align(alignment: Alignment.centerRight, child: SkeletonBlock(width: 64, height: 12))),
            ]),
          ),
      ]),
    );
  }
}
