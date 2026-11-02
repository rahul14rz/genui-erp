import 'package:flutter/material.dart';

import '../samples.dart';
import '../theme.dart';
import '../tokens.dart';
import 'charts.dart';
import 'data_table.dart';
import 'forms.dart';
import 'kpi_strip.dart';
import 'notice.dart';
import 'panel.dart';
import 'records.dart';

/// Every catalog component with sample data, used by the dev-only gallery
/// route and by the golden tests.
class CatalogGallery extends StatelessWidget {
  const CatalogGallery({super.key, this.skeletons = false, this.only});

  final bool skeletons;

  /// Render a single component, by name, instead of the full list.
  final String? only;

  static const names = [
    'Panel',
    'KpiStrip',
    'DataTable',
    'TrendChart',
    'BreakdownBar',
    'RecordCard',
    'Timeline',
    'ApprovalForm',
    'ConfirmAction',
    'FilterBar',
    'Notice',
  ];

  Widget _build(String name) {
    void noop([Object? _, Object? __]) {}
    if (skeletons) {
      return switch (name) {
        'KpiStrip' => const KpiStripSkeleton(),
        'DataTable' => const DataTableSkeleton(),
        'TrendChart' || 'BreakdownBar' => const ChartSkeleton(),
        _ => const RecordSkeleton(),
      };
    }
    return switch (name) {
      'Panel' => PanelView(
        data: Samples.panel,
        onFollowUp: noop,
        children: [KpiStripView(Samples.kpis), TrendChartView(Samples.trend)],
      ),
      'KpiStrip' => KpiStripView(Samples.kpis),
      'DataTable' => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DataTableView(Samples.table, onSort: noop, onPage: noop, onRowAction: noop),
          const SizedBox(height: Space.x4),
          DataTableView(Samples.emptyTable),
        ],
      ),
      'TrendChart' => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TrendChartView(Samples.trend),
          const SizedBox(height: Space.x4),
          TrendChartView(Samples.bars),
        ],
      ),
      'BreakdownBar' => BreakdownBarView(Samples.breakdown),
      'RecordCard' => RecordCardView(Samples.record, onLink: noop),
      'Timeline' => TimelineView(Samples.timeline),
      'ApprovalForm' => ApprovalFormView(Samples.approval, onDecide: noop),
      'ConfirmAction' => ConfirmActionView(Samples.confirm, onConfirm: noop, onCancel: noop),
      'FilterBar' => FilterBarView(Samples.filters, onApply: noop),
      'Notice' => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final n in Samples.notices) ...[NoticeView(n), const SizedBox(height: Space.x3)],
        ],
      ),
      _ => throw ArgumentError(name),
    };
  }

  @override
  Widget build(BuildContext context) {
    final list = only == null ? names : [only!];
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final name in list) ...[
          if (only == null) ...[
            Text(name, style: context.type.caption.copyWith(color: context.colors.textSecondary)),
            const SizedBox(height: Space.x2),
          ],
          _build(name),
          const SizedBox(height: Space.x8),
        ],
      ],
    );
  }
}
