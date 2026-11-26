-- The Purchasing Request page was a placeholder ("Under setup") that no
-- tile linked to; purchase requests are made in Employee Documents. The
-- page is gone, and so is its line in Settings > Page access.
delete from page_access where page = 'purchasing-request';
