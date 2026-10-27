import { Card, CardContent, Typography } from "@mui/material";

import { DraggableItem } from "../lib/model";

export default function DraggableListItem({
  item,
  provided,
}: {
  item: DraggableItem;
  provided: any;
}) {
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
    >
      <Card sx={{ borderRadius: "18px" }}>
        <CardContent sx={{ py: 1.5 }}>
          <Typography variant="body2">{item.content}</Typography>
        </CardContent>
      </Card>
    </div>
  );
}
