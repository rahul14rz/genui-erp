import 'dart:convert';

import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart' hide DataTable;
import 'package:genui/genui.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import 'erp_scope.dart';

const erpCatalogId = 'genui-erp.dev:catalog/v1';

void _fire(CatalogItemContext c, String name, Map<String, Object?> context) => c.dispatchEvent(
      UserActionEvent(surfaceId: c.surfaceId, name: name, sourceComponentId: c.id, context: context),
    );

CatalogItem _item(String name, Widget Function(CatalogItemContext c, Map<String, Object?> json) build) => CatalogItem(
      name: name,
      dataSchema: Schema.fromMap(jsonDecode(catalogSchemas[name]!) as Map<String, Object?>),
      widgetBuilder: (c) => build(c, Map<String, Object?>.from(c.data as Map)),
    );

/// Turns a row action into concrete action input: {"field": "x"} reads the row,
/// and "ask" values come from a small dialog.
Future<Map<String, Object?>?> _actionInput(BuildContext context, ActionRef a, Map<String, Object?> row) async {
  final input = <String, Object?>{
    for (final e in a.input.entries)
      e.key: e.value is Map && (e.value! as Map).containsKey('field') ? row[(e.value! as Map)['field']] : e.value,
  };
  final ask = a.ask ?? const <ActionRefAsk>[];
  if (ask.isEmpty) return input;
  final controllers = {for (final f in ask) f.key: TextEditingController()};
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(a.label, style: ctx.type.heading),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final f in ask) ...[
          Text(f.label, style: ctx.type.caption.copyWith(color: ctx.colors.textSecondary)),
          const SizedBox(height: Space.x1),
          TextField(
            controller: controllers[f.key],
            autofocus: f == ask.first,
            keyboardType: f.kind == ActionRefAskKind.text ? TextInputType.text : TextInputType.number,
            onSubmitted: (_) => Navigator.pop(ctx, true),
          ),
          const SizedBox(height: Space.x3),
        ],
        Text('You will see exactly what changes before anything is saved.', style: ctx.type.caption),
      ]),
      actions: [
        ErpButton(label: 'Cancel', onPressed: () => Navigator.pop(ctx, false)),
        ErpButton(label: 'Preview', kind: ButtonKind.primary, onPressed: () => Navigator.pop(ctx, true)),
      ],
    ),
  );
  if (ok != true) return null;
  for (final f in ask) {
    final text = controllers[f.key]!.text.trim();
    input[f.key] = switch (f.kind) {
      ActionRefAskKind.text => text,
      ActionRefAskKind.number => num.tryParse(text),
      ActionRefAskKind.money => ((num.tryParse(text) ?? 0) * 100).round(),
    };
  }
  return input;
}

/// The genui catalog. Each item parses the wire JSON into the generated model
/// and renders the erp_design widget. User actions go back to the server as
/// A2UI events; the server decides what they do.
Catalog buildErpCatalog() => Catalog(
      [
        _item('Panel', (c, json) {
          final data = Panel.fromJson(json);
          return PanelView(
            data: data,
            onFollowUp: ErpScope.of(c.buildContext).ask,
            children: [for (final id in data.children) c.buildChild(id)],
          );
        }),
        _item('Notice', (c, json) => NoticeView(Notice.fromJson(json))),
        _item('KpiStrip', (c, json) => KpiStripView(KpiStrip.fromJson(json))),
        _item('DataTable', (c, json) {
          final data = DataTable.fromJson(json);
          return DataTableView(
            data,
            onPage: (offset) => _fire(c, 'table.page', {'offset': offset}),
            onSort: (key, direction) => _fire(c, 'table.sort', {'key': key, 'direction': direction.json}),
            onRowOpen: ErpScope.of(c.buildContext).openRow,
            onRowAction: (a, row) async {
              final input = await _actionInput(c.buildContext, a, row);
              if (input != null) _fire(c, 'action.preview', {'action': a.action, 'input': input});
            },
          );
        }),
        _item('TrendChart', (c, json) => TrendChartView(TrendChart.fromJson(json))),
        _item('BreakdownBar', (c, json) => BreakdownBarView(BreakdownBar.fromJson(json))),
        _item('RecordCard', (c, json) => RecordCardView(RecordCard.fromJson(json), onLink: ErpScope.of(c.buildContext).ask)),
        _item('Timeline', (c, json) => TimelineView(Timeline.fromJson(json))),
        _item('ApprovalForm', (c, json) {
          final data = ApprovalForm.fromJson(json);
          return ApprovalFormView(
            data,
            onDecide: (decision, reason) => _fire(c, 'action.preview', {
              'action': 'decideApproval',
              'input': {'requestId': data.requestId, 'decision': decision.name, 'reason': reason},
            }),
          );
        }),
        _item('ConfirmAction', (c, json) => _Confirm(c, ConfirmAction.fromJson(json))),
        _item('FilterBar', (c, json) => FilterBarView(FilterBar.fromJson(json), onApply: (values) => _fire(c, 'filters.apply', {'values': values}))),
      ],
      catalogId: erpCatalogId,
    );

/// Holds the busy state between Confirm and the server's answer.
class _Confirm extends StatefulWidget {
  const _Confirm(this.c, this.data);
  final CatalogItemContext c;
  final ConfirmAction data;

  @override
  State<_Confirm> createState() => _ConfirmState();
}

class _ConfirmState extends State<_Confirm> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) => ConfirmActionView(
        widget.data,
        busy: _busy,
        onConfirm: () {
          setState(() => _busy = true);
          _fire(widget.c, 'action.confirm', {'idempotencyKey': widget.data.idempotencyKey});
        },
        onCancel: () => _fire(widget.c, 'action.cancel', {'idempotencyKey': widget.data.idempotencyKey}),
      );
}
