import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import DraggableListItem from "./draggable_list_item";
import { DraggableItem } from "../lib/model";

export default function DraggableList({ items, onDragEnd }: { items: DraggableItem[], onDragEnd?: (newItems: DraggableItem[]) => void }) {
    const onDragEndWrapper = (result: any) => {
        const newItems = Array.from(items);
        const [removed] = newItems.splice(result.source.index, 1);
        newItems.splice(result.destination.index, 0, removed);
        onDragEnd?.(newItems);
    };
    return <DragDropContext onDragEnd={onDragEndWrapper}>
        <Droppable droppableId="droppable">
            {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef}>
                    {items.map((item, index) => (
                        <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(provided) => (
                                <DraggableListItem
                                    provided={provided}
                                    item={item}
                                />
                            )}
                        </Draggable>
                    ))}
                    {provided.placeholder}
                </div>
            )}
        </Droppable>
    </DragDropContext>
}

